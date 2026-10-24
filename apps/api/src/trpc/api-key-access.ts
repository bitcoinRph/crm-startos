import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { type ApiKeyPermissions, permits } from "../api-keys/api-key-profiles";

export type VerifiedApiKey = {
	id: string;
	referenceId: string;
	permissions: ApiKeyPermissions | null;
};

const PURGE_PROCEDURE = /^(companies|contacts|deals)\.(purge|bulkPurge)$/;

export function apiKeyRateLimited(): TRPCError {
	return new TRPCError({
		code: "TOO_MANY_REQUESTS",
		message: "API key rate limit exceeded. Retry after a short wait.",
	});
}

export const HUMAN_ONLY_PROCEDURE = {
	agentRunApproval: "agents.decideRunApproval",
} as const;

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

export function authorizeApiKeyProcedure(
	key: VerifiedApiKey,
	path: string,
	type: string,
): ApiKeyDecision {
	if (path.startsWith("sales.")) return "sales";
	if (path.startsWith("apiKeys.")) return "deny";
	if (path.startsWith("codex.")) return "deny";
	if (PURGE_PROCEDURE.test(path)) return "deny";
	if (path === HUMAN_ONLY_PROCEDURE.agentRunApproval) return "deny";
	if (key.permissions === null) return "allow";
	if (path === "intake.submit" && permits(key.permissions, "intake", "write"))
		return "allow";
	return permits(key.permissions, "crm", type === "query" ? "read" : "write")
		? "allow"
		: "deny";
}
