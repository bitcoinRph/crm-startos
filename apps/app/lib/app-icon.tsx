import Logo, { LOGO_COLORS } from "@crm/ui/components/logo";
import { ImageResponse } from "next/og";
import { APP_ICON, type AppIconShape } from "./app-icon-config";

export function appIconResponse(size: number, shape: AppIconShape) {
	const mark = Math.round(size * (1 - 2 * APP_ICON.tile.insetRatio));

	return new ImageResponse(
		<div
			style={{
				width: "100%",
				height: "100%",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				background: LOGO_COLORS.tile,
				borderRadius: shape === "tile" ? size * APP_ICON.tile.cornerRatio : 0,
			}}
		>
			<Logo width={mark} height={mark} slab={LOGO_COLORS.slab} />
		</div>,
		{ width: size, height: size },
	);
}
