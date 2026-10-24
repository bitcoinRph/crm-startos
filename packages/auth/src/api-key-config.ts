const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;

export const API_KEY_RATE_LIMIT = {
	timeWindow: MINUTE_MS,
	maxRequests: 3_000,
} as const;
