import { APIError } from "better-auth/api";
import { API_KEY_HEADER, API_KEY_PREFIX } from "./api-keys";

export function guardApiKeyAuthAccess(path: string, headers?: Headers): void {
	const authorization = headers?.get("authorization");
	const hasKey =
		headers?.has(API_KEY_HEADER) ||
		authorization?.toLowerCase().startsWith(`bearer ${API_KEY_PREFIX}`);
	if (hasKey && path !== "/get-session") {
		throw new APIError("FORBIDDEN", {
			message: "API keys can only resolve sessions on the auth API.",
		});
	}
}
