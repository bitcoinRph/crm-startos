import { Module } from "@nestjs/common";
import { CompaniesModule } from "../companies/companies.module";
import { ContactsModule } from "../contacts/contacts.module";
import { DealsModule } from "../deals/deals.module";
import { FieldsModule } from "../fields/fields.module";
import { TrpcModule } from "../trpc/trpc.module";
import { CsvRouter } from "./csv.router";
import { CsvExportService } from "./csv-export.service";
import { CsvImportService } from "./csv-import.service";

@Module({
	imports: [
		CompaniesModule,
		ContactsModule,
		DealsModule,
		FieldsModule,
		TrpcModule,
	],
	providers: [CsvExportService, CsvImportService, CsvRouter],
	exports: [CsvExportService],
})
export class CsvModule {}
