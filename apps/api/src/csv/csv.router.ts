import { Inject } from "@nestjs/common";
import { Input, Query, Router, UseMiddlewares } from "nestjs-trpc";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { restMeta } from "../trpc/openapi";
import { csvExportInput, csvExportOutput } from "./csv.contracts";
import type { CsvEntity } from "./csv-columns";
import { CsvExportService } from "./csv-export.service";

@Router({ alias: "csv" })
@UseMiddlewares(AuthMiddleware)
export class CsvRouter {
	constructor(
		@Inject(CsvExportService) private readonly exporter: CsvExportService,
	) {}

	@Query({
		input: csvExportInput,
		output: csvExportOutput,
		meta: restMeta("GET", "/csv/export", ["CSV"]),
	})
	async export(@Input("entity") entity: CsvEntity) {
		return this.exporter.export(entity);
	}
}
