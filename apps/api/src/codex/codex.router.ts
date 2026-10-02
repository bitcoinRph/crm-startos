import { Inject } from "@nestjs/common";
import {
	Ctx,
	Input,
	Mutation,
	Query,
	Router,
	UseMiddlewares,
} from "nestjs-trpc";
import type { z } from "zod";
import type { AuthedTrpcContext } from "../trpc/context.types";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { SessionOnlyMiddleware } from "../trpc/middlewares/session-only.middleware";
import { restMeta } from "../trpc/openapi";
import {
	codexConnectApiKeyInput,
	codexModelsOutput,
	codexPollOutput,
	codexSetModelInput,
	codexSignInOutput,
	codexStatusOutput,
} from "./codex.contracts";
import { CodexService } from "./codex.service";

@Router({ alias: "codex" })
@UseMiddlewares(AuthMiddleware, SessionOnlyMiddleware)
export class CodexRouter {
	constructor(@Inject(CodexService) private readonly codex: CodexService) {}

	@Query({
		output: codexStatusOutput,
		meta: restMeta("GET", "/codex/status", ["Codex"]),
	})
	async status(@Ctx() ctx: AuthedTrpcContext) {
		return this.codex.status(ctx.user.id);
	}

	@Query({
		output: codexModelsOutput,
		meta: restMeta("GET", "/codex/models", ["Codex"]),
	})
	async models(@Ctx() ctx: AuthedTrpcContext) {
		return this.codex.models(ctx.user.id);
	}

	@Mutation({
		output: codexSignInOutput,
		meta: restMeta("POST", "/codex/sign-in", ["Codex"]),
	})
	async startSignIn(@Ctx() ctx: AuthedTrpcContext) {
		return this.codex.startSignIn(ctx.user.id);
	}

	@Mutation({
		output: codexPollOutput,
		meta: restMeta("POST", "/codex/sign-in/poll", ["Codex"]),
	})
	async pollSignIn(@Ctx() ctx: AuthedTrpcContext) {
		return this.codex.pollSignIn(ctx.user.id);
	}

	@Mutation({
		input: codexConnectApiKeyInput,
		output: codexStatusOutput,
		meta: restMeta("POST", "/codex/api-key", ["Codex"]),
	})
	async connectApiKey(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof codexConnectApiKeyInput>,
	) {
		return this.codex.connectApiKey(ctx.user.id, input.apiKey);
	}

	@Mutation({
		input: codexSetModelInput,
		output: codexStatusOutput,
		meta: restMeta("PATCH", "/codex/model", ["Codex"]),
	})
	async setModel(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof codexSetModelInput>,
	) {
		return this.codex.setModel(
			ctx.user.id,
			input.modelId,
			input.contextWindowTokens,
		);
	}

	@Mutation({
		output: codexStatusOutput,
		meta: restMeta("DELETE", "/codex/connection", ["Codex"]),
	})
	async disconnect(@Ctx() ctx: AuthedTrpcContext) {
		return this.codex.disconnect(ctx.user.id);
	}
}
