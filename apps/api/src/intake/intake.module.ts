import { Module } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module";
import { CompaniesModule } from "../companies/companies.module";
import { TrpcModule } from "../trpc/trpc.module";
import { IntakeRouter } from "./intake.router";
import { IntakeService } from "./intake.service";

@Module({
	imports: [TrpcModule, AgentModule, CompaniesModule],
	providers: [IntakeService, IntakeRouter],
})
export class IntakeModule {}
