import { describe, expect, it } from "bun:test";
import {
	bindInferenceMode,
	type InferenceModeBinding,
	modeFromEnvironment,
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
});
