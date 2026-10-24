export const INTAKE = {
	email: { maxLength: 320 },
	name: { maxLength: 120 },
	domain: { maxLength: 253 },
	message: { maxLength: 5000 },
	source: { maxLength: 40 },
} as const;
