import { Module } from "@nestjs/common";
import { ApiKeyAuditService } from "./api-key-audit.service";

@Module({
	providers: [ApiKeyAuditService],
	exports: [ApiKeyAuditService],
})
export class ApiKeyAuditModule {}
