export const ACTIVITIES = {
	followUps: {
		maxDays: 31,
		defaultLimit: 25,
		maxLimit: 100,
		maxCursorLength: 4096,
		maxTimeZoneLength: 64,
		maxAsOfLength: 64,
		asOfMin: "0002-01-01T00:00:00.000Z",
		asOfMaxExclusive: "9999-01-01T00:00:00.000Z",
	},
} as const;
