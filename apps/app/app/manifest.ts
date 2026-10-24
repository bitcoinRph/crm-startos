import { BRAND } from "@crm/env/brand";
import { LOGO_COLORS } from "@crm/ui/components/logo";
import type { MetadataRoute } from "next";
import { APP_ICON } from "@/lib/app-icon-config";

export default function manifest(): MetadataRoute.Manifest {
	return {
		name: BRAND.product,
		short_name: BRAND.product,
		icons: APP_ICON.manifestSizes.map((size) => ({
			src: `/icon/${size}`,
			sizes: `${size}x${size}`,
			type: APP_ICON.contentType,
			purpose: "maskable",
		})),
		theme_color: LOGO_COLORS.tile,
		background_color: LOGO_COLORS.tile,
		display: "standalone",
	};
}
