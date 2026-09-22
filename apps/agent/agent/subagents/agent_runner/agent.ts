import { defineAgent } from "eve";
import { z } from "zod";
import { LOCAL_INFERENCE } from "../../lib/inference/config";
import { inferenceModel } from "../../lib/model";

export default defineAgent({
	description:
		"Execute one immutable deployed CRM agent version and persist its result and every side effect.",
	model: inferenceModel("runner"),
	modelContextWindowTokens: LOCAL_INFERENCE.contextWindowTokens,
	outputSchema: z.object({
		summary: z.string().min(1).max(1000),
		result: z.record(z.string(), z.unknown()).nullable(),
	}),
	limits: {
		maxInputTokensPerSession: 500_000,
		maxOutputTokensPerSession: 40_000,
		sessionTimeoutMs: 24 * 60 * 60 * 1000,
	},
});
