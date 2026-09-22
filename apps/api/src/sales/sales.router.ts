import {
	salesApproveInput,
	salesRequestIdInput,
	salesRequestInput,
	salesSubmitInput,
} from "@crm/validation/sales";
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
import { salesActor } from "./sales.auth";
import {
	salesPendingInput,
	salesPendingOutput,
	salesProposalOutput,
	salesRequestOutput,
	salesWire,
} from "./sales.contracts";
import { SALES_SCOPES, SalesService } from "./sales.service";

@Router({ alias: "sales" })
@UseMiddlewares(AuthMiddleware)
export class SalesRouter {
	constructor(@Inject(SalesService) private readonly sales: SalesService) {}

	@Mutation({
		input: salesRequestInput,
		output: salesRequestOutput,
		meta: restMeta("POST", "/sales/requests", ["Sales"]),
	})
	async createRequest(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof salesRequestInput>,
	) {
		return salesRequestOutput.parse(
			salesWire(
				await this.sales.createRequest(await this.readingWriter(ctx), input),
			),
		);
	}

	@Query({
		input: salesRequestIdInput,
		output: salesRequestOutput,
		meta: restMeta("GET", "/sales/requests/{requestId}", ["Sales"]),
	})
	async getRequest(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof salesRequestIdInput>,
	) {
		return salesRequestOutput.parse(
			salesWire(
				await this.sales.getRequest(
					await salesActor(ctx, SALES_SCOPES.read),
					input.requestId,
				),
			),
		);
	}

	@Mutation({
		input: salesRequestIdInput,
		output: salesRequestOutput,
		meta: restMeta("POST", "/sales/requests/fail", ["Sales"]),
	})
	async failRequest(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof salesRequestIdInput>,
	) {
		return salesRequestOutput.parse(
			salesWire(
				await this.sales.failRequest(
					await this.readingWriter(ctx),
					input.requestId,
				),
			),
		);
	}

	@Query({
		input: salesPendingInput,
		output: salesPendingOutput,
		meta: restMeta("POST", "/sales/requests/pending", ["Sales"]),
	})
	async pendingRequests(@Ctx() ctx: AuthedTrpcContext) {
		return salesPendingOutput.parse(
			salesWire(
				await this.sales.pendingRequests(
					await salesActor(ctx, SALES_SCOPES.read),
				),
			),
		);
	}

	@Mutation({
		input: salesSubmitInput,
		output: salesProposalOutput,
		meta: restMeta("POST", "/sales/proposals", ["Sales"]),
	})
	async storeProposal(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof salesSubmitInput>,
	) {
		return salesProposalOutput.parse(
			salesWire(
				await this.sales.storeProposal(await this.readingWriter(ctx), input),
			),
		);
	}

	private async readingWriter(ctx: AuthedTrpcContext) {
		const writer = await salesActor(ctx, SALES_SCOPES.write);
		await salesActor(ctx, SALES_SCOPES.read);
		return writer.kind === "apiKey"
			? { ...writer, scopes: [...writer.scopes, SALES_SCOPES.read] }
			: writer;
	}

	@Mutation({
		input: salesApproveInput,
		output: salesProposalOutput,
		meta: restMeta("POST", "/sales/proposals/approve", ["Sales"]),
	})
	async approveProposal(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof salesApproveInput>,
	) {
		return salesProposalOutput.parse(
			salesWire(
				await this.sales.approveProposal(
					await salesActor(ctx, SALES_SCOPES.approve),
					input,
				),
			),
		);
	}
}
