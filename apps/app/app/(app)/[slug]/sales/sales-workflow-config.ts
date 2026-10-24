const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const POLL_TIMEOUT_MINUTES = 10;

export const SALES_WORKFLOW = {
	pollIntervalMs: 2 * SECOND_MS,
	pollTimeoutMinutes: POLL_TIMEOUT_MINUTES,
	pollTimeoutMs: POLL_TIMEOUT_MINUTES * MINUTE_MS,
	queue: { refreshMs: 30 * SECOND_MS, limit: 25 },
	sourceMaxLength: 2048,
} as const;
