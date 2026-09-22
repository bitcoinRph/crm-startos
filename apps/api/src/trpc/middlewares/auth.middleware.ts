import { auth } from "@crm/auth";
import { Injectable } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import type {
	MiddlewareOptions,
	MiddlewareResponse,
	TRPCMiddleware,
} from "nestjs-trpc";
import { setRequestUserId } from "../../logging/request-context";
import {
	authorizeApiKeyProcedure,
	keyFromHeaders,
	type VerifiedApiKey,
} from "../api-key-access";
import type { AuthedTrpcContext, BaseTrpcContext } from "../context.types";

export async function verifiedApiKey(
	ctx: BaseTrpcContext,
	userId: string,
): Promise<VerifiedApiKey | null> {
	const key = ctx.req ? keyFromHeaders(ctx.req.headers) : null;
	if (!key) return null;
	const verified = await auth.api.verifyApiKey({ body: { key } });
	if (!verified.valid || !verified.key || verified.key.referenceId !== userId) {
		throw new TRPCError({ code: "FORBIDDEN", message: "API key denied." });
	}
	return {
		referenceId: verified.key.referenceId,
		permissions: verified.key.permissions ?? null,
	};
}

@Injectable()
export class AuthMiddleware implements TRPCMiddleware {
	async use(opts: MiddlewareOptions): Promise<MiddlewareResponse> {
		const ctx = opts.ctx as BaseTrpcContext;
		const user = ctx.session?.user;
		if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });

		const key = await verifiedApiKey(ctx, user.id);
		if (key && authorizeApiKeyProcedure(key, opts.path, opts.type) === "deny") {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "API key scope denied.",
			});
		}

		setRequestUserId(user.id);
		const nextCtx: AuthedTrpcContext = { ...ctx, user };
		return opts.next({ ctx: nextCtx });
	}
}
