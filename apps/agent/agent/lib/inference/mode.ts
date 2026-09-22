export type InferenceMode = "LOCAL" | "LEGACY_GATEWAY" | "DISABLED";

export type InferenceModeBinding = {
	mode: InferenceMode | null;
};

export function modeFromEnvironment(value: string | undefined): InferenceMode {
	if (value === "LOCAL" || value === "LEGACY_GATEWAY") return value;
	return "DISABLED";
}

export function bindInferenceMode<T extends InferenceModeBinding>(
	binding: T,
	mode: InferenceMode,
): T & { mode: InferenceMode } {
	if (binding.mode !== null && binding.mode !== mode) {
		throw new Error(
			"INFERENCE_MODE_CHANGED: Start a new conversation after changing inference mode.",
		);
	}
	return { ...binding, mode };
}
