import { expect, test } from "bun:test";
import { selectionIdentity } from "../agent/lib/inference/local";
import { createLocalRouting } from "../agent/lib/inference/routing";

const config = {
	baseURL: "http://127.0.0.1:11434/v1",
	modelId: "qwen3.5:4b",
	contextWindowTokens: 4096,
	maxOutputTokens: 1024,
};
const input = {
	prompt: [
		{
			role: "user" as const,
			content: [{ type: "text" as const, text: "synthetic" }],
		},
	],
};
function fixture() {
	let pin: string | null = null;
	let current: typeof config | null = config;
	let approved = true;
	const routing = createLocalRouting(
		{
			get: () => pin,
			set: (value) => {
				pin = value;
			},
		},
		() => current,
		async () => approved,
		() => true,
	);
	return {
		routing,
		setCurrent: (value: typeof config | null) => {
			current = value;
		},
		deny: () => {
			approved = false;
		},
		pin: () => pin,
	};
}

test("missing trusted admission denies a fresh child without pinning the current route", async () => {
	let pin: string | null = null;
	let versionReads = 0;
	const routing = createLocalRouting(
		{
			get: () => pin,
			set: (value) => {
				pin = value;
			},
		},
		() => config,
		async () => {
			versionReads++;
			return true;
		},
	);
	await routing.start();
	expect(pin).toBeNull();
	await expect((await routing.step()).model.doGenerate(input)).rejects.toThrow(
		"LOCAL_INFERENCE_UNAVAILABLE",
	);
	await expect((await routing.step()).model.doStream(input)).rejects.toThrow(
		"LOCAL_INFERENCE_UNAVAILABLE",
	);
	expect(versionReads).toBe(0);
});

test("denied children cannot use even a matching preexisting route", async () => {
	const pin = selectionIdentity(config);
	let writes = 0;
	const routing = createLocalRouting(
		{
			get: () => pin,
			set: () => {
				writes++;
			},
		},
		() => config,
		async () => true,
		() => false,
	);
	await routing.start();
	expect(writes).toBe(0);
	await expect((await routing.step()).model.doStream(input)).rejects.toThrow(
		"LOCAL_INFERENCE_UNAVAILABLE",
	);
});

test("repeated admission preserves the original pin after a route change", async () => {
	const { routing, pin, setCurrent } = fixture();
	await routing.start();
	setCurrent({ ...config, modelId: "changed" });
	await routing.start();
	expect(pin()).toBe(selectionIdentity(config));
	await expect((await routing.step()).model.doGenerate(input)).rejects.toThrow(
		"LOCAL_INFERENCE_UNAVAILABLE",
	);
});

test("revoked root admission rejects cached generation and compaction handles", async () => {
	let admitted = true;
	let pin: string | null = null;
	const routing = createLocalRouting(
		{
			get: () => pin,
			set: (value) => {
				pin = value;
			},
		},
		() => config,
		async () => true,
		() => admitted,
	);
	await routing.start();
	const selection = await routing.step();
	admitted = false;
	await expect(selection.model.doGenerate(input)).rejects.toThrow(
		"LOCAL_INFERENCE_ROUTE_CHANGED",
	);
	await expect(selection.model.doStream(input)).rejects.toThrow(
		"LOCAL_INFERENCE_ROUTE_CHANGED",
	);
});

test("unmarked historical sessions receive an explicit deny selection", async () => {
	const { routing } = fixture();
	await expect((await routing.step()).model.doGenerate(input)).rejects.toThrow(
		"LOCAL_INFERENCE_UNAVAILABLE",
	);
	await expect(routing.fallback.doStream(input)).rejects.toThrow(
		"LOCAL_INFERENCE_UNAVAILABLE",
	);
});

test("new sessions pin the complete local route", async () => {
	const { routing, pin } = fixture();
	expect(await routing.start()).toBeNull();
	expect(pin()).toBe(selectionIdentity(config));
	const selection = await routing.step();
	expect(selection.model.modelId).toBe(config.modelId);
	expect(selection.modelContextWindowTokens).toBe(4096);
});

test("configuration changes block continuation instead of switching providers", async () => {
	const { routing, setCurrent } = fixture();
	await routing.start();
	const existing = await routing.step();
	setCurrent({ ...config, modelId: "other:4b" });
	await expect((await routing.step()).model.doStream(input)).rejects.toThrow(
		"LOCAL_INFERENCE_UNAVAILABLE",
	);
	await expect(existing.model.doGenerate(input)).rejects.toThrow(
		"LOCAL_INFERENCE_ROUTE_CHANGED",
	);
});

test("old versions and failed version reads return deny, not null", async () => {
	const { routing, deny } = fixture();
	await routing.start();
	deny();
	await expect((await routing.step()).model.doGenerate(input)).rejects.toThrow(
		"LOCAL_INFERENCE_UNAVAILABLE",
	);
	const broken = createLocalRouting(
		{
			get: () => {
				throw new Error("storage down");
			},
			set: () => {},
		},
		() => config,
		async () => true,
		() => true,
	);
	await expect((await broken.step()).model.doGenerate(input)).rejects.toThrow(
		"LOCAL_INFERENCE_UNAVAILABLE",
	);
});

test("missing or invalid configuration never prevents loading the agent", async () => {
	const broken = createLocalRouting(
		{ get: () => null, set: () => {} },
		() => {
			throw new Error("invalid config");
		},
		async () => true,
		() => true,
	);
	expect(await broken.start()).toBeNull();
	await expect((await broken.step()).model.doStream(input)).rejects.toThrow(
		"LOCAL_INFERENCE_UNAVAILABLE",
	);
});
