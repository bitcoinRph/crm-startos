const MIB = 1024 * 1024;

export const CSV = {
	export: {
		maxRows: 20_000,
		pageSize: 500,
	},
	import: {
		maxRows: 500,
		maxBytes: 2 * MIB,
	},
} as const;
