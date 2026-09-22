import { describe, expect, it } from "bun:test";
import {
	bindInferenceMode,
	type InferenceModeBinding,
	modeFromEnvironment,
	stepDecision,
} from "../agent/lib/inference/mode";

describe("inference mode contract", () => {
	it("requires an explicit supported mode", () => {
		expect(modeFromEnvironment(undefined)).toBe("DISABLED");
		expect(modeFromEnvironment("")).toBe("DISABLED");
		expect(modeFromEnvironment("LOCAL")).toBe("LOCAL");
		expect(modeFromEnvironment("LEGACY_GATEWAY")).toBe("LEGACY_GATEWAY");
		expect(modeFromEnvironment("legacy_gateway")).toBe("DISABLED");
	});

	it("does not silently change an existing session destination", () => {
		const initial: InferenceModeBinding = { mode: null };
		const local = bindInferenceMode(initial, "LOCAL");
		expect(local).toEqual({ mode: "LOCAL" });
		expect(bindInferenceMode(local, "LOCAL")).toEqual(local);
		expect(() => bindInferenceMode(local, "LEGACY_GATEWAY")).toThrow(
			"INFERENCE_MODE_CHANGED",
		);
	});

	it("keeps disabled sessions disabled until a new session starts", () => {
		const disabled = bindInferenceMode({ mode: null }, "DISABLED");
		expect(() => bindInferenceMode(disabled, "LOCAL")).toThrow(
			"INFERENCE_MODE_CHANGED",
		);
	});

	it("keeps a bound legacy session on its selection and denies every other bound mode", () => {
		expect(stepDecision({ mode: "LEGACY_GATEWAY" }, "LEGACY_GATEWAY")).toBe(
			"keep",
		);
		expect(stepDecision({ mode: "LOCAL" }, "LOCAL")).toBe("deny");
		expect(stepDecision({ mode: "DISABLED" }, "DISABLED")).toBe("deny");
	});

	it("denies a session whose mode no longer matches the configuration", () => {
		expect(stepDecision({ mode: "LEGACY_GATEWAY" }, "LOCAL")).toBe("deny");
		expect(stepDecision({ mode: "LOCAL" }, "LEGACY_GATEWAY")).toBe("deny");
	});

	it("binds a session started before modes existed to legacy only when legacy is configured", () => {
		expect(stepDecision({ mode: null }, "LEGACY_GATEWAY")).toBe("bind-legacy");
		expect(stepDecision({ mode: null }, "LOCAL")).toBe("deny");
		expect(stepDecision({ mode: null }, "DISABLED")).toBe("deny");
	});
});
