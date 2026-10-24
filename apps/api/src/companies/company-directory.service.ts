import { EnrichmentStatus } from "@crm/db";
import { lockIdempotencyKey } from "@crm/db/idempotency";
import { Injectable, Logger } from "@nestjs/common";
import { AgentTriggerService } from "../agent/agent-trigger.service";
import { domainFromEmail } from "./domain";

type CompanyDirectoryOptions = {
	ownerId?: string | null;
	name?: string | null;
};

@Injectable()
export class CompanyDirectoryService {
	private readonly logger = new Logger(CompanyDirectoryService.name);

	constructor(private readonly agent: AgentTriggerService) {}

	async companyForEmail(
		email: string,
		options: CompanyDirectoryOptions = {},
	): Promise<string | null> {
		const domain = domainFromEmail(email);
		return domain ? this.companyForDomain(domain, options) : null;
	}

	async companyForDomain(
		domain: string,
		options: CompanyDirectoryOptions = {},
	): Promise<string> {
		const outcome = await this.agent.withCrmEvents(async (tx, emit) => {
			await lockIdempotencyKey(tx, `company-directory:${domain}`);
			const existing = await tx.company.findFirst({
				where: { domain, archivedAt: null },
				select: { id: true },
			});
			if (existing) return { id: existing.id, created: false as const };

			const company = await tx.company.create({
				data: {
					name: options.name ?? domain,
					domain,
					website: `https://${domain}`,
					enrichmentStatus: EnrichmentStatus.PENDING,
					ownerId: options.ownerId ?? null,
				},
				select: { id: true, name: true, domain: true, createdAt: true },
			});
			await emit({
				type: "company.created",
				record: { kind: "company", id: company.id },
				occurredAt: company.createdAt,
				data: { name: company.name, domain: company.domain },
			});
			return { id: company.id, created: true as const };
		});
		if (!outcome.created) return outcome.id;

		await this.agent.companyCreated(
			outcome.id,
			`Created from an email domain (${domain}) — it has no name but the domain`,
		);

		this.logger.log({
			message: "Company created from an email domain",
			companyId: outcome.id,
			domain,
		});

		return outcome.id;
	}
}
