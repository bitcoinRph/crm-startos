import { appIconResponse } from "@/lib/app-icon";
import { APP_ICON } from "@/lib/app-icon-config";

export const size = { width: APP_ICON.appleSize, height: APP_ICON.appleSize };

export const contentType = APP_ICON.contentType;

export default function AppleIcon() {
	return appIconResponse(APP_ICON.appleSize, "square");
}
