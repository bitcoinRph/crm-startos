import { Module } from "@nestjs/common";
import { ApiKeyAuditModule } from "../api-keys/api-key-audit.module";
import { CompaniesModule } from "../companies/companies.module";
import { ContactsModule } from "../contacts/contacts.module";
import { DealsModule } from "../deals/deals.module";
import { RecordChangesModule } from "../record-changes/record-changes.module";
import { ArchiveRetentionController } from "./archive-retention.controller";

@Module({
	imports: [
		ApiKeyAuditModule,
		CompaniesModule,
		ContactsModule,
		DealsModule,
		RecordChangesModule,
	],
	controllers: [ArchiveRetentionController],
})
export class ArchiveModule {}
