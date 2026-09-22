import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

const source = (path: string) =>
	readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("legacy builder and runner remain in Eve discovery", () => {
	for (const [path, role] of [
		["agent/subagents/agent_builder/agent.ts", "builder"],
		["agent/subagents/agent_runner/agent.ts", "runner"],
	] as const) {
		expect(existsSync(new URL(`../${path}`, import.meta.url))).toBe(true);
		expect(source(path)).toContain(`inferenceModel("${role}")`);
	}
	expect(existsSync(new URL("../disabled-subagents", import.meta.url))).toBe(
		false,
	);
});

test("local mode denies every role and legacy mode stays explicit", () => {
	const model = source("agent/lib/model.ts");
	expect(model).toContain('configuredMode() !== "LEGACY_GATEWAY"');
	expect(model).toContain('!== "LEGACY_GATEWAY") return null');
	expect(model).toContain('if (decision === "deny") return deniedSelection()');
	expect(model).toContain("unavailableModel()");
	expect(model).not.toContain("routing");
});

test("a mode change requires a new session", () => {
	const mode = source("agent/lib/inference/mode.ts");
	expect(mode).toContain("INFERENCE_MODE_CHANGED");
	expect(mode).not.toContain("Gateway");
});

test("builder versions use the explicit legacy selection", () => {
	const builder = source("agent/lib/builder-runtime.ts");
	expect(builder).toContain("const model = await versionModel()");
	expect(builder).not.toContain("localVersionModel");
});
