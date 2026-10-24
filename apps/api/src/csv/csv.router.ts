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
	csvExportInput,
	csvExportOutput,
	csvImportInput,
	csvImportOutput,
} from "./csv.contracts";
import type { CsvEntity } from "./csv-columns";
import { CsvExportService } from "./csv-export.service";
import { CsvImportService } from "./csv-import.service";

@Router({ alias: "csv" })
@UseMiddlewares(AuthMiddleware)
export class CsvRouter {
	constructor(
		@Inject(CsvExportService) private readonly exporter: CsvExportService,
		@Inject(CsvImportService) private readonly importer: CsvImportService,
	) {}

	@Query({
		input: csvExportInput,
		output: csvExportOutput,
		meta: restMeta("GET", "/csv/export", ["CSV"]),
	})
	async export(@Input("entity") entity: CsvEntity) {
		return this.exporter.export(entity);
	}

	@Mutation({
		input: csvImportInput,
		output: csvImportOutput,
		meta: restMeta("POST", "/csv/import", ["CSV"]),
	})
	async import(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof csvImportInput>,
	) {
		return this.importer.import(input, ctx.user.id);
	}
}
