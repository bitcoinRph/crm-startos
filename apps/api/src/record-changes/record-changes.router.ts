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
import { restMeta } from "../trpc/openapi";
import {
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
	async list(@Input() input: z.infer<typeof recordChangesListInput>) {
		return this.changes.list(input);
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
}
