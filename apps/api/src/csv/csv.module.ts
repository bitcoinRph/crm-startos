import { Module } from "@nestjs/common";
import { FieldsModule } from "../fields/fields.module";
import { TrpcModule } from "../trpc/trpc.module";
import { CsvRouter } from "./csv.router";
import { CsvExportService } from "./csv-export.service";

@Module({
	imports: [FieldsModule, TrpcModule],
	providers: [CsvExportService, CsvRouter],
	exports: [CsvExportService],
})
export class CsvModule {}
