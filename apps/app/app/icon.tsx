import { appIconResponse } from "@/lib/app-icon";
import { APP_ICON } from "@/lib/app-icon-config";

export function generateImageMetadata() {
	return APP_ICON.icons.map((icon) => ({
		id: String(icon.size),
		size: { width: icon.size, height: icon.size },
		contentType: APP_ICON.contentType,
	}));
}

export default async function Icon({ id }: { id: Promise<string | number> }) {
	const requested = String(await id);
	const icon =
		APP_ICON.icons.find((entry) => String(entry.size) === requested) ??
		APP_ICON.icons[0];
	return appIconResponse(icon.size, icon.shape);
}
