import { Module } from "@nestjs/common";
import { TrpcModule } from "../trpc/trpc.module";
import { CodexRouter } from "./codex.router";
import { CodexService } from "./codex.service";

@Module({
	imports: [TrpcModule],
	providers: [CodexService, CodexRouter],
})
export class CodexModule {}
