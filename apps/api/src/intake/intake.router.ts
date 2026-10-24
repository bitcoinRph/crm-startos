import { Inject } from "@nestjs/common";
import { Ctx, Input, Mutation, Router, UseMiddlewares } from "nestjs-trpc";
import type { z } from "zod";
import type { AuthedTrpcContext } from "../trpc/context.types";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { restMeta } from "../trpc/openapi";
import { intakeSubmitInput, intakeSubmitOutput } from "./intake.contracts";
import { IntakeService } from "./intake.service";

@Router({ alias: "intake" })
@UseMiddlewares(AuthMiddleware)
export class IntakeRouter {
	constructor(@Inject(IntakeService) private readonly intake: IntakeService) {}

	@Mutation({
		input: intakeSubmitInput,
		output: intakeSubmitOutput,
		meta: restMeta("POST", "/intake", ["Intake"]),
	})
	async submit(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof intakeSubmitInput>,
	) {
		return this.intake.submit(input, ctx.user.id);
	}
}
