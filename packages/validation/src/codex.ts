import { z } from "zod";

export const codexCredentialKind = z.enum(["CHATGPT", "API_KEY"]);
export const codexConnectionState = z.enum(["ACTIVE", "NEEDS_RECONNECT"]);

export const codexStatus = z.strictObject({
	available: z.boolean(),
	connected: z.boolean(),
	kind: codexCredentialKind.nullable(),
	state: codexConnectionState.nullable(),
	label: z.string().nullable(),
	planType: z.string().nullable(),
	modelId: z.string().nullable(),
	modelContextWindowTokens: z.number().int().positive().nullable(),
	connectedAt: z.iso.datetime().nullable(),
	lastError: z.string().nullable(),
});

export const codexDeviceStart = z.strictObject({
	verificationUrl: z.url(),
	userCode: z.string().trim().min(1).max(64),
	expiresAt: z.iso.datetime(),
	intervalSeconds: z.number().int().positive(),
});

export const codexPollOutcome = z.discriminatedUnion("state", [
	z.strictObject({ state: z.literal("pending") }),
	z.strictObject({ state: z.literal("connected"), status: codexStatus }),
	z.strictObject({ state: z.literal("expired") }),
	z.strictObject({ state: z.literal("failed"), reason: z.string() }),
]);

export const codexModel = z.strictObject({
	id: z.string().min(1).max(200),
	name: z.string().min(1).max(200),
	contextWindowTokens: z.number().int().positive().nullable(),
});

export const codexModelList = z.strictObject({
	available: z.boolean(),
	reason: z.string().nullable(),
	models: z.array(codexModel),
});

export const codexModelId = z
	.string()
	.trim()
	.min(1)
	.max(200)
	.regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const codexApiKey = z.string().trim().min(20).max(400).regex(/^\S+$/);

export const codexBridgeUser = z.strictObject({ userId: z.string().min(1) });

export const codexBridgeApiKey = codexBridgeUser.extend({
	apiKey: codexApiKey,
});

export const CODEX_CONTEXT_WINDOW = {
	minTokens: 8_192,
	maxTokens: 2_000_000,
} as const;

export const codexContextWindow = z
	.number()
	.int()
	.min(CODEX_CONTEXT_WINDOW.minTokens)
	.max(CODEX_CONTEXT_WINDOW.maxTokens);

export const codexBridgeModel = codexBridgeUser.extend({
	modelId: codexModelId.nullable(),
	contextWindowTokens: codexContextWindow.nullable(),
});

export const codexFailure = z.strictObject({ error: z.string() });

export type CodexBridgeRequest =
	| z.infer<typeof codexBridgeUser>
	| z.infer<typeof codexBridgeApiKey>
	| z.infer<typeof codexBridgeModel>;

export type CodexStatus = z.infer<typeof codexStatus>;
export type CodexDeviceStart = z.infer<typeof codexDeviceStart>;
export type CodexPollOutcome = z.infer<typeof codexPollOutcome>;
export type CodexModel = z.infer<typeof codexModel>;
export type CodexModelList = z.infer<typeof codexModelList>;

export const CODEX_UNAVAILABLE_STATUS: CodexStatus = {
	available: false,
	connected: false,
	kind: null,
	state: null,
	label: null,
	planType: null,
	modelId: null,
	modelContextWindowTokens: null,
	connectedAt: null,
	lastError: null,
};
