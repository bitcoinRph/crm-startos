export const APP_ICON = {
	tile: { cornerRatio: 0.35, insetRatio: 0.15 },
	icons: [
		{ size: 32, shape: "tile" },
		{ size: 192, shape: "square" },
		{ size: 512, shape: "square" },
	],
	manifestSizes: [192, 512],
	appleSize: 180,
	contentType: "image/png",
} as const;

export type AppIconShape = (typeof APP_ICON.icons)[number]["shape"];
