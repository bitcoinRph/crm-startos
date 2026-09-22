import { auth } from "@crm/auth";
import { TRPCError } from "@trpc/server";
import { keyFromHeaders } from "../trpc/api-key-access";
import type { AuthedTrpcContext } from "../trpc/context.types";
import { SALES_SCOPES, type SalesActor } from "./sales.service";

function permits(
	permissions: Record<string, string[]> | null | undefined,
	resource: string,
	action: string,
): boolean {
	return permissions?.[resource]?.includes(action) ?? false;
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
		const permissions = verified.key.permissions;
		const allowed =
			scope === SALES_SCOPES.read
				? permits(permissions, "crm", "read") ||
					permits(permissions, "sales", "read")
				: permits(permissions, "sales", "proposal:write");
		if (!allowed) {
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
