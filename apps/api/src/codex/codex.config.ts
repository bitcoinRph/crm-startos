const SECOND_MS = 1_000;

export const CODEX_BRIDGE = {
	timeoutMs: {
		status: 10 * SECOND_MS,
		signIn: 25 * SECOND_MS,
		apiKey: 25 * SECOND_MS,
		models: 25 * SECOND_MS,
		model: 40 * SECOND_MS,
		disconnect: 25 * SECOND_MS,
	},
} as const;
