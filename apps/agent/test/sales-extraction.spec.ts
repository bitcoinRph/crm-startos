import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import {
	approvedSalesProfile,
	extractSalesNote,
	type SalesExtractionModel,
} from "../agent/lib/sales-extraction";

const input = {
	source: "Alex is VP of Sales. Interested in the pilot. Send pricing Friday.",
	candidateIds: ["contact-1"],
	profileId: "qwen-local-experimental",
	profileRevision: "sales-qwen-v1",
};
const operations = [
	{
		type: "contact_fact",
		contactId: "contact-1",
		field: "jobTitle",
		value: "VP of Sales",
		evidence: "VP of Sales",
	},
	{
		type: "create_note",
		contactId: "contact-1",
		field: null,
		value: "Interested in the pilot.",
		evidence: "Interested in the pilot.",
	},
	{
		type: "create_task",
		contactId: "contact-1",
		field: null,
		value: "Send pricing Friday.",
		evidence: "Send pricing Friday.",
	},
];
const config = {
	baseURL: "http://127.0.0.1:11434/v1",
	modelId: "qwen3.5:4b",
	contextWindowTokens: 4096,
	maxOutputTokens: 1024,
};
const originalConfig = process.env.CRM_LOCAL_INFERENCE_JSON;
const originalMode = process.env.CRM_INFERENCE_MODE;
let network: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;

beforeEach(() => {
	delete process.env.CRM_LOCAL_INFERENCE_JSON;
	delete process.env.CRM_INFERENCE_MODE;
	network = spyOn(globalThis, "fetch").mockImplementation(async () => {
		throw new Error("NETWORK_FORBIDDEN");
	});
});

afterEach(() => {
	network.mockRestore();
	if (originalConfig === undefined) delete process.env.CRM_LOCAL_INFERENCE_JSON;
	else process.env.CRM_LOCAL_INFERENCE_JSON = originalConfig;
	if (originalMode === undefined) delete process.env.CRM_INFERENCE_MODE;
	else process.env.CRM_INFERENCE_MODE = originalMode;
});

test("returns three exact extractive proposals through the injected function", async () => {
	let calls = 0;
	const model: SalesExtractionModel = async (request) => {
		calls++;
		expect(request.system).toContain("untrusted");
		expect(JSON.parse(request.prompt)).toEqual({
			source: input.source,
			contactId: "contact-1",
		});
		expect(request.maxOutputTokens).toBe(768);
		expect(request.abortSignal).toBeInstanceOf(AbortSignal);
		return operations;
	};
	expect(await extractSalesNote(input, model)).toEqual(operations);
	expect(calls).toBe(1);
	expect(network).not.toHaveBeenCalled();
	expect(Object.isFrozen(approvedSalesProfile)).toBe(true);
});

test("rejects stale profiles, ambiguous candidates and unbounded inputs before inference", async () => {
	let calls = 0;
	const model: SalesExtractionModel = async () => {
		calls++;
		return [];
	};
	for (const change of [
		{ profileId: "other" },
		{ profileRevision: "sales-qwen-v0" },
		{ candidateIds: [] },
		{ candidateIds: ["contact-1", "contact-2"] },
		{ candidateIds: ["contact-1", "contact-1"] },
		{ candidateIds: [""] },
		{ source: "" },
		{ source: "  " },
		{ source: "x".repeat(2049) },
		{ source: "🙂".repeat(600) },
		{ baseURL: "https://example.com" },
	])
		await expect(
			extractSalesNote({ ...input, ...change }, model),
		).rejects.toThrow();
	expect(calls).toBe(0);
	expect(network).not.toHaveBeenCalled();
});

test("rejects unsupported, invented, reworded, duplicate and excess operations atomically", async () => {
	for (const result of [
		[...operations, operations[0]],
		[operations[0], operations[0]],
		[{ ...operations[0], contactId: "contact-2" }],
		[{ ...operations[0], field: "email" }],
		[{ ...operations[0], type: "delete_contact" }],
		[{ ...operations[0], value: "Vice President of Sales" }],
		[{ ...operations[1], value: "Wants a pilot" }],
		[{ ...operations[2], value: "Send a quote Friday" }],
		[{ ...operations[0], value: "CEO", evidence: "CEO" }],
		[{ ...operations[0], value: "", evidence: "" }],
		[{ ...operations[1], field: "jobTitle" }],
		[{ ...operations[0], field: null }],
		[{ ...operations[0], confidence: 1 }],
		{ operations },
		"[]",
		null,
	])
		await expect(extractSalesNote(input, async () => result)).rejects.toThrow();
	expect(network).not.toHaveBeenCalled();
});

test("empty extraction is distinct from a failed model and never retries", async () => {
	expect(await extractSalesNote(input, async () => [])).toEqual([]);
	let calls = 0;
	await expect(
		extractSalesNote(input, async () => {
			calls++;
			throw new Error("MODEL_FAILED");
		}),
	).rejects.toThrow("MODEL_FAILED");
	expect(calls).toBe(1);
});

test("missing configuration, remote endpoints and unapproved models deny before transport", async () => {
	process.env.CRM_INFERENCE_MODE = "LOCAL";
	for (const value of [
		undefined,
		"{}",
		JSON.stringify({ ...config, baseURL: "https://example.com/v1" }),
		JSON.stringify({ ...config, modelId: "qwen3:8b" }),
	]) {
		if (value === undefined) delete process.env.CRM_LOCAL_INFERENCE_JSON;
		else process.env.CRM_LOCAL_INFERENCE_JSON = value;
		await expect(extractSalesNote(input)).rejects.toThrow();
	}
	expect(network).not.toHaveBeenCalled();
});

test("missing, unknown, disabled and legacy modes deny before native or SDK transport", async () => {
	process.env.CRM_LOCAL_INFERENCE_JSON = JSON.stringify(config);
	for (const mode of [undefined, "UNKNOWN", "DISABLED", "LEGACY_GATEWAY"]) {
		if (mode === undefined) delete process.env.CRM_INFERENCE_MODE;
		else process.env.CRM_INFERENCE_MODE = mode;
		await expect(extractSalesNote(input)).rejects.toThrow(
			"SALES_LOCAL_MODE_REQUIRED",
		);
	}
	expect(network).not.toHaveBeenCalled();
});

test("installed Qwen warms with bounded native options then uses guarded strict SDK generation", async () => {
	process.env.CRM_INFERENCE_MODE = "LOCAL";
	process.env.CRM_LOCAL_INFERENCE_JSON = JSON.stringify(config);
	const paths: string[] = [];
	network.mockImplementation(async (url, init) => {
		const target = new URL(String(url));
		expect(target.origin).toBe("http://127.0.0.1:11434");
		paths.push(target.pathname);
		expect(init?.redirect).toBe("error");
		expect(new Headers(init?.headers).has("authorization")).toBe(false);
		expect(init?.signal).toBeInstanceOf(AbortSignal);
		switch (target.pathname) {
			case "/api/version":
				return Response.json({ version: "0.34.0" });
			case "/api/tags":
				return Response.json({ models: [{ name: config.modelId }] });
			case "/api/generate":
				expect(JSON.parse(String(init?.body))).toEqual({
					model: config.modelId,
					prompt: ".",
					stream: false,
					think: false,
					options: { num_ctx: 4096, num_predict: 1 },
					keep_alive: "2m",
				});
				return Response.json({ model: config.modelId, done: true });
			case "/api/ps":
				return Response.json({
					models: [{ name: config.modelId, context_length: 4096 }],
				});
			case "/v1/chat/completions": {
				const body = JSON.parse(String(init?.body));
				expect(body.max_tokens).toBe(768);
				expect(body.reasoning_effort).toBe("none");
				expect(body.tools).toBeUndefined();
				expect(body.response_format.type).toBe("json_schema");
				return Response.json({
					id: "synthetic",
					created: 1,
					model: config.modelId,
					choices: [
						{
							index: 0,
							message: {
								role: "assistant",
								content: JSON.stringify({ operations }),
							},
							finish_reason: "stop",
						},
					],
				});
			}
			default:
				throw new Error("DESTINATION_DENIED");
		}
	});
	expect(await extractSalesNote(input)).toEqual(operations);
	expect(paths).toEqual([
		"/api/version",
		"/api/tags",
		"/api/generate",
		"/api/version",
		"/api/ps",
		"/v1/chat/completions",
	]);
});

test("unverified version or missing installed model blocks warmup without downloads", async () => {
	process.env.CRM_INFERENCE_MODE = "LOCAL";
	process.env.CRM_LOCAL_INFERENCE_JSON = JSON.stringify(config);
	for (const scenario of [
		"version",
		"missing",
		"ambiguous",
		"redirect",
		"warmup",
	]) {
		const paths: string[] = [];
		network.mockImplementation(async (url) => {
			const path = new URL(String(url)).pathname;
			paths.push(path);
			if (scenario === "redirect")
				return new Response(null, {
					status: 302,
					headers: { location: "https://example.com" },
				});
			if (path === "/api/version")
				return Response.json({
					version: scenario === "version" ? "0.33.0" : "0.34.0",
				});
			if (path === "/api/tags")
				return Response.json({
					models:
						scenario === "missing"
							? []
							: scenario === "ambiguous"
								? [{ name: config.modelId }, { name: config.modelId }]
								: [{ name: config.modelId }],
				});
			if (path === "/api/generate")
				return Response.json({ done: false, model: config.modelId });
			throw new Error("UNEXPECTED_TRANSPORT");
		});
		await expect(extractSalesNote(input)).rejects.toThrow();
		expect(
			paths.some(
				(path) => path.includes("chat/completions") || path.includes("pull"),
			),
		).toBe(false);
		if (scenario !== "warmup") expect(paths).not.toContain("/api/generate");
	}
});

test("operator configuration changes during warmup deny before source dispatch", async () => {
	process.env.CRM_INFERENCE_MODE = "LOCAL";
	process.env.CRM_LOCAL_INFERENCE_JSON = JSON.stringify(config);
	const paths: string[] = [];
	network.mockImplementation(async (url) => {
		const path = new URL(String(url)).pathname;
		paths.push(path);
		if (path === "/api/version") return Response.json({ version: "0.34.0" });
		if (path === "/api/tags") {
			delete process.env.CRM_LOCAL_INFERENCE_JSON;
			return Response.json({ models: [{ name: config.modelId }] });
		}
		throw new Error("UNEXPECTED_TRANSPORT");
	});
	await expect(extractSalesNote(input)).rejects.toThrow();
	expect(paths).toEqual(["/api/version", "/api/tags"]);
});
