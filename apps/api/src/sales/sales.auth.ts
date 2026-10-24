import { auth } from "@crm/auth";
import { TRPCError } from "@trpc/server";
import { type ApiKeyPermissions, permits } from "../api-keys/api-key-profiles";
import { keyFromHeaders } from "../trpc/api-key-access";
import type { AuthedTrpcContext } from "../trpc/context.types";
import { SALES_SCOPES, type SalesActor } from "./sales.service";

export const SALES_MCP_SCOPES = new Map<string, readonly string[]>([
	["sales.getRequest", [SALES_SCOPES.read]],
	["sales.pendingRequests", [SALES_SCOPES.read]],
	["sales.reviewQueue", [SALES_SCOPES.read]],
	["sales.createRequest", [SALES_SCOPES.write, SALES_SCOPES.read]],
	["sales.storeProposal", [SALES_SCOPES.write, SALES_SCOPES.read]],
	["sales.failRequest", [SALES_SCOPES.write, SALES_SCOPES.read]],
]);

export function salesKeyAllows(
	permissions: ApiKeyPermissions | null | undefined,
	scope: string,
): boolean {
	if (!permissions || scope === SALES_SCOPES.approve) return false;
	return scope === SALES_SCOPES.read
		? permits(permissions, "crm", "read") ||
				permits(permissions, "sales", "read")
		: permits(permissions, "sales", "proposal:write");
}

export async function salesActor(
	ctx: AuthedTrpcContext,
	scope: string,
): Promise<SalesActor> {
	if (!ctx.session?.user || !ctx.user)
		throw new TRPCError({ code: "UNAUTHORIZED" });
	const key = ctx.req ? keyFromHeaders(ctx.req.headers) : null;
	if (key) {
		if (scope === SALES_SCOPES.approve) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "Human session required.",
			});
		}
		const verified = await auth.api.verifyApiKey({ body: { key } });
		if (
			!verified.valid ||
			!verified.key ||
			verified.key.referenceId !== ctx.user.id
		) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "Sales scope denied.",
			});
		}
		if (!salesKeyAllows(verified.key.permissions, scope)) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "Sales scope denied.",
			});
		}
		return {
			kind: "apiKey",
			userId: ctx.user.id,
			keyId: verified.key.id,
			scopes: [scope],
		};
	}
	return {
		kind: "session",
		userId: ctx.user.id,
		sessionId: ctx.session.session.id,
	};
}
