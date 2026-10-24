import type { ApiKeyCallOutcome, Db } from "@crm/db";
import { Injectable, Logger } from "@nestjs/common";
import { ARCHIVE } from "../archive/archive-config";
import { InjectDatabase } from "../database/database.constants";
import { API_KEY_AUDIT } from "./api-key-audit-config";

export type ApiKeyCallRecord = {
	keyId: string;
	procedure: string;
	type: string;
	outcome: ApiKeyCallOutcome;
};

export type ApiKeyCallEntry = {
	procedure: string;
	type: string;
	outcome: ApiKeyCallOutcome;
	createdAt: Date;
};

@Injectable()
export class ApiKeyAuditService {
	private readonly logger = new Logger(ApiKeyAuditService.name);

	constructor(@InjectDatabase() private readonly db: Db) {}

	record(call: ApiKeyCallRecord): void {
		const { keyId, procedure, type, outcome } = call;
		Promise.resolve()
			.then(() =>
				this.db.apiKeyCall.create({
					data: { keyId, procedure, type, outcome },
				}),
			)
			.catch((error) =>
				this.logger.warn(
					{ message: "API key call not recorded", apiKeyId: keyId, procedure },
					error instanceof Error ? error.stack : String(error),
				),
			);
	}

	recent(userId: string, keyId: string): Promise<ApiKeyCallEntry[]> {
		return this.db.apiKeyCall.findMany({
			where: { keyId, key: { referenceId: userId } },
			select: {
				procedure: true,
				type: true,
				outcome: true,
				createdAt: true,
			},
			orderBy: [{ createdAt: "desc" }, { id: "desc" }],
			take: API_KEY_AUDIT.recentLimit,
		});
	}

	async purgeExpired(before: Date): Promise<number> {
		let removed = 0;

		for (let batch = 0; batch < ARCHIVE.prune.auditMaxBatches; batch += 1) {
			const expired = await this.db.apiKeyCall.findMany({
				where: { createdAt: { lt: before } },
				select: { id: true },
				take: ARCHIVE.prune.maxBatch,
			});
			if (expired.length === 0) break;

			const { count } = await this.db.apiKeyCall.deleteMany({
				where: { id: { in: expired.map((row) => row.id) } },
			});
			removed += count;
			if (expired.length < ARCHIVE.prune.maxBatch) break;
		}

		return removed;
	}
}
