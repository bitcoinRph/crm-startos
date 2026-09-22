import "@crm/env/load";

import { onTelemetryProblem, syncVersion } from "@crm/telemetry";
import { defineAgent } from "eve";
import { logCapabilities } from "./lib/capabilities";
import { LOCAL_INFERENCE } from "./lib/inference/config";
import { inferenceModel } from "./lib/model";

void logCapabilities();

onTelemetryProblem((message) => console.debug(`[telemetry] ${message}`));

void syncVersion();

export default defineAgent({
	model: inferenceModel(),
	modelContextWindowTokens: LOCAL_INFERENCE.contextWindowTokens,
	limits: {
		maxInputTokensPerSession: 500_000,
		maxOutputTokensPerSession: 50_000,
		sessionTimeoutMs: 30 * 24 * 60 * 60 * 1000,
	},
});
