import { LOGO_COLORS } from "@crm/ui/components/logo";
import type { MetadataRoute } from "next";
import { APP_ICON } from "@/lib/app-icon-config";

export default function manifest(): MetadataRoute.Manifest {
	return {
		name: "Comp AI CRM",
		short_name: "Comp AI CRM",
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
