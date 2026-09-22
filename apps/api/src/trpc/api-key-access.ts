import { z } from "zod";

export type VerifiedApiKey = {
	referenceId: string;
	permissions: Record<string, string[]> | null;
};

export type ApiKeyDecision = "allow" | "deny" | "sales";

type HeaderValue = string | string[] | undefined;
type HeaderMap = Record<string, HeaderValue>;

const headerValue = z.union([z.string(), z.array(z.string())]).optional();

function first(value: HeaderValue): string | null {
	const parsed = headerValue.parse(value);
	return Array.isArray(parsed) ? (parsed[0] ?? null) : (parsed ?? null);
}

export function keyFromHeaders(headers: HeaderMap): string | null {
	const explicit = first(headers["x-api-key"]);
	if (explicit) return explicit;
	const authorization = first(headers.authorization);
	if (!authorization) return null;
	const match = /^Bearer (crm_[A-Za-z0-9._~-]+)$/.exec(authorization);
	return match?.[1] ?? null;
}

function permits(
	permissions: Record<string, string[]>,
	resource: string,
	action: string,
): boolean {
	return permissions[resource]?.includes(action) ?? false;
}

export function authorizeApiKeyProcedure(
	key: VerifiedApiKey,
	path: string,
	type: string,
): ApiKeyDecision {
	if (path.startsWith("sales.")) return "sales";
	if (path.startsWith("apiKeys.")) return "deny";
	if (key.permissions === null) return "allow";
	return permits(key.permissions, "crm", type === "query" ? "read" : "write")
		? "allow"
		: "deny";
}
