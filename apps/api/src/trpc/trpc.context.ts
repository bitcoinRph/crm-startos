import { auth } from "@crm/auth";
import { Injectable } from "@nestjs/common";
import { APIError } from "better-auth/api";
import { fromNodeHeaders } from "better-auth/node";
import type { Request } from "express";
import type { ContextOptions, TRPCContext } from "nestjs-trpc";
import { apiKeyRateLimited, keyFromHeaders } from "./api-key-access";
import type { BaseTrpcContext } from "./context.types";

export async function createBaseTrpcContext(
	req: Request | undefined,
): Promise<BaseTrpcContext> {
	const headers = req ? fromNodeHeaders(req.headers) : null;
	const key = req ? keyFromHeaders(req.headers) : null;
	if (headers && key && !headers.has("x-api-key"))
		headers.set("x-api-key", key);
	const session = headers
		? await auth.api.getSession({ headers }).catch((error) => {
				if (error instanceof APIError && error.status === "TOO_MANY_REQUESTS") {
					throw apiKeyRateLimited();
				}
				return null;
			})
		: null;
	return { req, session };
}

@Injectable()
export class TrpcContext implements TRPCContext {
	async create(opts: ContextOptions): Promise<BaseTrpcContext> {
		const req = "req" in opts ? opts.req : undefined;
		return createBaseTrpcContext(req);
	}
}
