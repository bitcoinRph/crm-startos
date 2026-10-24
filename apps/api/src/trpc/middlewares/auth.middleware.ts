import { auth } from "@crm/auth";
import { runAsChangeActor } from "@crm/db/change-actor";
import { Inject, Injectable } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import type {
	MiddlewareOptions,
	MiddlewareResponse,
	TRPCMiddleware,
} from "nestjs-trpc";
import { ApiKeyAuditService } from "../../api-keys/api-key-audit.service";
import { setRequestUserId } from "../../logging/request-context";
import {
	apiKeyRateLimited,
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
	if (verified.error?.code === "RATE_LIMITED") throw apiKeyRateLimited();
	if (!verified.valid || !verified.key || verified.key.referenceId !== userId) {
		throw new TRPCError({ code: "FORBIDDEN", message: "API key denied." });
	}
	return {
		id: verified.key.id,
		referenceId: verified.key.referenceId,
		permissions: verified.key.permissions ?? null,
	};
}

@Injectable()
export class AuthMiddleware implements TRPCMiddleware {
	constructor(
		@Inject(ApiKeyAuditService) private readonly audit: ApiKeyAuditService,
	) {}

	async use(opts: MiddlewareOptions): Promise<MiddlewareResponse> {
		const ctx = opts.ctx as BaseTrpcContext;
		const user = ctx.session?.user;
		if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });

		const key = await verifiedApiKey(ctx, user.id);
		const decision = key
			? authorizeApiKeyProcedure(key, opts.path, opts.type)
			: null;
		const record = (outcome: "allowed" | "denied") => {
			if (key)
				this.audit.record({
					keyId: key.id,
					procedure: opts.path,
					type: opts.type,
					outcome,
				});
		};

		if (decision === "deny") {
			record("denied");
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "API key scope denied.",
			});
		}

		setRequestUserId(user.id);
		const nextCtx: AuthedTrpcContext = { ...ctx, user };
		const actor = key
			? { kind: "API_KEY" as const, id: key.id, userId: user.id }
			: { kind: "USER" as const, id: user.id };
		const next = () =>
			runAsChangeActor(actor, () => opts.next({ ctx: nextCtx }));

		if (decision !== "sales") {
			record("allowed");
			return next();
		}

		const result = await next();
		const refused =
			!result.ok &&
			result.error instanceof TRPCError &&
			result.error.code === "FORBIDDEN";
		record(refused ? "denied" : "allowed");
		return result;
	}
}
