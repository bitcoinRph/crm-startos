import { ActivityType, type Db, Prisma, RecordSource } from "@crm/db";
import { activityMetaFields } from "@crm/validation/activity-meta";
import { Injectable, Logger } from "@nestjs/common";
import { AgentTriggerService } from "../agent/agent-trigger.service";
import { CompanyDirectoryService } from "../companies/company-directory.service";
import { companyDomain } from "../companies/domain";
import { ActivityStampService } from "../crm/activity-stamp.service";
import { blankToNull, normalizeEmail } from "../crm/values";
import { InjectDatabase } from "../database/database.constants";
import { splitName } from "../mailbox/participants";
import type { IntakeSubmitInput, IntakeSubmitOutput } from "./intake.contracts";

const SUPPRESSED: IntakeSubmitOutput = {
	status: "suppressed",
	contactId: null,
	created: false,
};

@Injectable()
export class IntakeService {
	private readonly logger = new Logger(IntakeService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly companies: CompanyDirectoryService,
		private readonly agent: AgentTriggerService,
		private readonly stamp: ActivityStampService,
	) {}

	async submit(
		input: IntakeSubmitInput,
		actingUserId: string,
	): Promise<IntakeSubmitOutput> {
		const email = normalizeEmail(input.email);
		if (!email) return SUPPRESSED;
		if (await this.suppressed(email)) return SUPPRESSED;

		const existing = await this.find(email);
		const contact = existing
			? { ...existing, created: false }
			: await this.create(input, email);

		await this.log(input, contact.id, contact.companyId, actingUserId);

		if (contact.created) {
			await this.agent.contactCreated(
				contact.id,
				`Submitted through the intake endpoint${input.source ? ` (${input.source})` : ""}`,
			);
			this.logger.log({
				message: "Contact filed from intake",
				contactId: contact.id,
			});
		}

		return {
			status: "accepted",
			contactId: contact.id,
			created: contact.created,
		};
	}

	private find(email: string) {
		return this.db.contact.findFirst({
			where: { email: { equals: email, mode: "insensitive" } },
			select: { id: true, companyId: true },
		});
	}

	private async create(input: IntakeSubmitInput, email: string) {
		const domain = companyDomain(input.companyDomain);
		const options = { name: blankToNull(input.companyName ?? "") };
		const companyId = domain
			? await this.companies.companyForDomain(domain, options)
			: await this.companies.companyForEmail(email, options);
		const name = splitName(
			[input.firstName, input.lastName].filter(Boolean).join(" ") || null,
			email,
		);

		try {
			const contact = await this.agent.withCrmEvents(async (tx, emit) => {
				const row = await tx.contact.create({
					data: {
						firstName: name.firstName,
						lastName: name.lastName,
						email,
						companyId,
						source: RecordSource.INTAKE,
					},
					select: {
						id: true,
						firstName: true,
						lastName: true,
						email: true,
						companyId: true,
						createdAt: true,
					},
				});
				await emit({
					type: "contact.created",
					record: { kind: "contact", id: row.id },
					occurredAt: row.createdAt,
					data: {
						firstName: row.firstName,
						lastName: row.lastName,
						email: row.email,
						companyId: row.companyId,
					},
				});
				return row;
			});
			return { id: contact.id, companyId: contact.companyId, created: true };
		} catch (error) {
			if (
				!(error instanceof Prisma.PrismaClientKnownRequestError) ||
				error.code !== "P2002"
			) {
				throw error;
			}
			const raced = await this.find(email);
			if (!raced) throw error;
			return { ...raced, created: false };
		}
	}

	private async log(
		input: IntakeSubmitInput,
		contactId: string,
		companyId: string | null,
		actingUserId: string,
	): Promise<void> {
		const activity = await this.db.activity.create({
			data: {
				type: ActivityType.NOTE,
				subject: input.source
					? `Submitted through ${input.source}`
					: "Submitted through the intake endpoint",
				body: blankToNull(input.message ?? ""),
				occurredAt: new Date(),
				contactId,
				companyId,
				createdById: actingUserId,
				meta: activityMetaFields.parse({
					automated: true,
					source: "intake",
					label: input.source ?? null,
					company: input.companyName ?? null,
				}),
			},
			select: { createdAt: true },
		});

		await this.stamp.touch({ contactId, companyId }, activity.createdAt);
	}

	private async suppressed(email: string): Promise<boolean> {
		const domain = email.split("@")[1] ?? "";
		const [contact, host] = await Promise.all([
			this.db.suppressedContact.findFirst({
				where: { email: { equals: email, mode: "insensitive" } },
				select: { email: true },
			}),
			this.db.suppressedDomain.findUnique({
				where: { domain },
				select: { domain: true },
			}),
		]);

		return contact !== null || host !== null;
	}
}
