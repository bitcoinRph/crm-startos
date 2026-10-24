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
import { keyFromHeaders } from "../trpc/api-key-access";
import type { AuthedTrpcContext } from "../trpc/context.types";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { restMeta } from "../trpc/openapi";
import {
	recordChangeForgetInput,
	recordChangeForgetOutput,
	recordChangeRevertInput,
	recordChangeRevertOutput,
	recordChangesListInput,
	recordChangesListOutput,
} from "./record-changes.contracts";
import { RecordChangesService } from "./record-changes.service";

@Router({ alias: "recordChanges" })
@UseMiddlewares(AuthMiddleware)
export class RecordChangesRouter {
	constructor(
		@Inject(RecordChangesService)
		private readonly changes: RecordChangesService,
	) {}

	@Query({
		input: recordChangesListInput,
		output: recordChangesListOutput,
		meta: restMeta("GET", "/record-changes", ["Record changes"]),
	})
	async list(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof recordChangesListInput>,
	) {
		return this.changes.list(
			input,
			keyFromHeaders(ctx.req?.headers ?? {}) === null,
		);
	}

	@Mutation({
		input: recordChangeRevertInput,
		output: recordChangeRevertOutput,
		meta: restMeta("POST", "/record-changes/revert", ["Record changes"]),
	})
	async revert(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof recordChangeRevertInput>,
	) {
		return this.changes.revert(input.id, ctx.user.id);
	}

	@Mutation({
		input: recordChangeForgetInput,
		output: recordChangeForgetOutput,
		meta: restMeta("POST", "/record-changes/forget", ["Record changes"]),
	})
	async forget(@Input() input: z.infer<typeof recordChangeForgetInput>) {
		return this.changes.forget(input.id);
	}
}
