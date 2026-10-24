import { Module } from "@nestjs/common";
import { CompaniesModule } from "../companies/companies.module";
import { ContactsModule } from "../contacts/contacts.module";
import { DealsModule } from "../deals/deals.module";
import { TrpcModule } from "../trpc/trpc.module";
import { RecordChangesRouter } from "./record-changes.router";
import { RecordChangesService } from "./record-changes.service";

@Module({
	imports: [TrpcModule, CompaniesModule, ContactsModule, DealsModule],
	providers: [RecordChangesService, RecordChangesRouter],
	exports: [RecordChangesService],
})
export class RecordChangesModule {}
