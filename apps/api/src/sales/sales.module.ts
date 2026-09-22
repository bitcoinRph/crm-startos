import { Module } from "@nestjs/common";
import { TrpcModule } from "../trpc/trpc.module";
import { SalesRouter } from "./sales.router";
import { SalesService } from "./sales.service";
@Module({
	imports: [TrpcModule],
	providers: [SalesService, SalesRouter],
	exports: [SalesService],
})
export class SalesModule {}
