import {
	type Db,
	DealStage,
	type FieldEntity,
	type FieldType,
	type Prisma,
	type RecordChangeModel,
} from "@crm/db";
import { runWithChangeExpectation } from "@crm/db/change-actor";
import { Inject, Injectable } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ARCHIVE } from "../archive/archive-config";
import { CompaniesService } from "../companies/companies.service";
import { ContactsService } from "../contacts/contacts.service";
import { InjectDatabase } from "../database/database.constants";
import type { DealUpdateInput } from "../deals/deals.contracts";
import { DealsService } from "../deals/deals.service";
import {
	type ChangeValue,
	type ChangeValues,
	changeValues,
	type RecordChangeOutput,
	type recordChangesListInput,
} from "./record-changes.contracts";

const text = z
	.string()
	.nullable()
	.transform((value) => value ?? "");
const optionalId = z.string().nullable();
const timestamp = z
	.string()
	.nullable()
	.transform((value) => (value === null ? null : `${value}Z`));

const contactRevert = z
	.strictObject({
		firstName: z.string(),
		lastName: text,
		email: text,
		phone: text,
		title: text,
		linkedinUrl: text,
		twitterUrl: text,
		githubUrl: text,
		companyId: optionalId,
		ownerId: optionalId,
		archivedAt: timestamp,
	})
	.partial();

const companyRevert = z
	.strictObject({
		name: z.string(),
		domain: text,
		website: text,
		description: text,
		industry: text,
		city: text,
		stateCode: text,
		country: text,
		phone: text,
		email: text,
		linkedinUrl: text,
		ownerId: optionalId,
		archivedAt: timestamp,
	})
	.partial();

const dealRevert = z
	.strictObject({
		name: z.string(),
		description: z.string().nullable(),
		companyId: z.string(),
		ownerId: z.string(),
		amount: z.number().nullable(),
		currency: z.string(),
		expectedCloseDate: timestamp,
		stage: z.enum(DealStage),
		closedAt: timestamp,
		closedReason: z.string().nullable(),
		archivedAt: timestamp,
	})
	.partial()
	.refine(
		(values) =>
			values.stage !== undefined ||
			(values.closedAt === undefined && values.closedReason === undefined),
	);

const currentRows = z.array(z.object({ row: changeValues }));

type RecordEntity = "COMPANY" | "CONTACT" | "DEAL";

type RevertPlan =
	| { kind: "record"; entity: "CONTACT"; plan: z.infer<typeof contactRevert> }
	| { kind: "record"; entity: "COMPANY"; plan: z.infer<typeof companyRevert> }
	| { kind: "record"; entity: "DEAL"; plan: z.infer<typeof dealRevert> }
	| { kind: "created"; entity: RecordEntity }
	| {
			kind: "field";
			entity: RecordEntity;
			fieldId: string;
			value: ChangeValue;
	  };

type FieldTarget = { key: string; type: FieldType; archivedAt: Date | null };

type ListInput = z.infer<typeof recordChangesListInput>;

const CONFLICT_MARKER = /crm_change_conflict: ([^`\]\n]+)/;

function valuesOf(change: RecordChangeModel, side: "before" | "after") {
	const value = change[side];
	return value === null ? null : changeValues.parse(value);
}

function revertPlan(
	change: RecordChangeModel,
	field: FieldTarget | undefined,
): RevertPlan | null {
	if (change.operation === "CREATE")
		return { kind: "created", entity: change.entity };
	const before = valuesOf(change, "before");
	if (!before) return null;
	if (change.fieldId !== null) {
		if (!field || field.archivedAt !== null) return null;
		const stored = Object.values(before)[0] ?? null;
		return {
			kind: "field",
			entity: change.entity,
			fieldId: change.fieldId,
			value: field.type === "DATE" && stored !== null ? `${stored}Z` : stored,
		};
	}
	if (change.entity === "CONTACT") {
		const parsed = contactRevert.safeParse(before);
		return parsed.success
			? { kind: "record", entity: "CONTACT", plan: parsed.data }
			: null;
	}
	if (change.entity === "COMPANY") {
		const parsed = companyRevert.safeParse(before);
		return parsed.success
			? { kind: "record", entity: "COMPANY", plan: parsed.data }
			: null;
	}
	const parsed = dealRevert.safeParse(before);
	return parsed.success
		? { kind: "record", entity: "DEAL", plan: parsed.data }
		: null;
}

function sameValue(
	left: ChangeValue | undefined,
	right: ChangeValue | undefined,
): boolean {
	return (left ?? null) === (right ?? null);
}

@Injectable()
export class RecordChangesService {
	constructor(
		@InjectDatabase() private readonly db: Db,
		@Inject(ContactsService) private readonly contacts: ContactsService,
		@Inject(CompaniesService) private readonly companies: CompaniesService,
		@Inject(DealsService) private readonly deals: DealsService,
	) {}

	async list(
		input: ListInput,
		revealValues: boolean,
	): Promise<RecordChangeOutput[]> {
		const where: Prisma.RecordChangeWhereInput = {
			entity: input.entity,
			recordId: input.recordId,
		};
		if (input.apiKeyId) {
			where.actorKind = "API_KEY";
			where.actorId = input.apiKeyId;
		}
		const rows = await this.db.recordChange.findMany({
			where,
			orderBy: [{ createdAt: "desc" }, { id: "desc" }],
			take: input.limit,
		});
		const fields = await this.fieldTargets(rows);
		return rows.map((row) => {
			const field = row.fieldId ? fields.get(row.fieldId) : undefined;
			return {
				id: row.id,
				entity: row.entity,
				recordId: row.recordId,
				fieldId: row.fieldId,
				fieldLabel: field?.label ?? null,
				operation: row.operation,
				before: revealValues ? valuesOf(row, "before") : null,
				after: revealValues ? valuesOf(row, "after") : null,
				valuesHidden: !revealValues,
				actorKind: row.actorKind,
				actorId: row.actorId,
				actorUserId: row.actorUserId,
				revertible: revertPlan(row, field) !== null,
				createdAt: row.createdAt.toISOString(),
			};
		});
	}

	async revert(id: string, actingUserId: string) {
		const change = await this.db.recordChange.findUnique({ where: { id } });
		if (!change)
			throw new TRPCError({ code: "NOT_FOUND", message: "No such change." });
		const fields = await this.fieldTargets([change]);
		const revert = revertPlan(
			change,
			change.fieldId ? fields.get(change.fieldId) : undefined,
		);
		if (!revert)
			throw new TRPCError({
				code: "BAD_REQUEST",
				message:
					"This change cannot be undone here. Its field no longer exists, or the change holds a value the CRM cannot write back.",
			});
		const current = await this.currentRow(change.entity, change.recordId);
		if (!current)
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "The record no longer exists.",
			});
		const after: ChangeValues = valuesOf(change, "after") ?? {};
		const moved =
			revert.kind === "record"
				? Object.keys(after).filter(
						(key) => !sameValue(current[key], after[key]),
					)
				: revert.kind === "created" && current.archivedAt !== null
					? ["archivedAt"]
					: [];
		if (moved.length)
			throw new TRPCError({
				code: "CONFLICT",
				message: `${moved.join(", ")} changed again after this change. Nothing was undone.`,
			});
		if (revert.kind === "record") await this.assertReferencesExist(revert);

		try {
			await runWithChangeExpectation(
				{
					entity: change.entity,
					recordId: change.recordId,
					fieldId: change.fieldId,
					values: revert.kind === "created" ? { archivedAt: null } : after,
				},
				() => this.apply(revert, change.recordId, actingUserId, fields),
			);
		} catch (error) {
			const conflict = CONFLICT_MARKER.exec(String(error));
			if (!conflict) throw error;
			throw new TRPCError({
				code: "CONFLICT",
				message: `${conflict[1]} changed again after this change. Nothing was undone.`,
			});
		}
		return { entity: change.entity, recordId: change.recordId };
	}

	async forget(id: string) {
		const { count } = await this.db.recordChange.deleteMany({ where: { id } });
		if (!count)
			throw new TRPCError({ code: "NOT_FOUND", message: "No such change." });
		return { id };
	}

	private async apply(
		revert: RevertPlan,
		recordId: string,
		actingUserId: string,
		fields: Map<string, FieldTarget & { label: string }>,
	) {
		if (revert.kind === "created") {
			if (revert.entity === "CONTACT") await this.contacts.archive(recordId);
			else if (revert.entity === "COMPANY")
				await this.companies.archive(recordId);
			else await this.deals.archive(recordId);
			return;
		}
		if (revert.kind === "field") {
			const key = fields.get(revert.fieldId)?.key;
			if (!key) return;
			const update = { fields: { [key]: revert.value } };
			if (revert.entity === "CONTACT")
				await this.contacts.update(recordId, update);
			else if (revert.entity === "COMPANY")
				await this.companies.update(recordId, update);
			else await this.deals.update(recordId, update);
			return;
		}
		if (revert.entity === "CONTACT") {
			const { archivedAt, ...update } = revert.plan;
			if (Object.keys(update).length)
				await this.contacts.update(recordId, update);
			if (archivedAt === null) await this.contacts.restore(recordId);
			if (archivedAt) await this.contacts.archive(recordId);
			return;
		}
		if (revert.entity === "COMPANY") {
			const { archivedAt, ...update } = revert.plan;
			if (Object.keys(update).length)
				await this.companies.update(recordId, update);
			if (archivedAt === null) await this.companies.restore(recordId);
			if (archivedAt) await this.companies.archive(recordId);
			return;
		}
		const {
			archivedAt,
			stage,
			closedAt,
			closedReason,
			amount,
			expectedCloseDate,
			...rest
		} = revert.plan;
		const update: DealUpdateInput = { ...rest };
		if (amount !== undefined)
			update.amountCents = amount === null ? null : Math.round(amount * 100);
		if (expectedCloseDate !== undefined)
			update.expectedCloseDate = expectedCloseDate;
		if (Object.keys(update).length) await this.deals.update(recordId, update);
		if (stage !== undefined)
			await this.deals.setStage(
				{ id: recordId, stage, closedReason: closedReason ?? undefined },
				actingUserId,
				closedAt ? new Date(closedAt) : undefined,
			);
		if (archivedAt === null) await this.deals.restore(recordId);
		if (archivedAt) await this.deals.archive(recordId);
	}

	private async fieldTargets(rows: RecordChangeModel[]) {
		const fieldIds = [
			...new Set(rows.flatMap((row) => (row.fieldId ? [row.fieldId] : []))),
		];
		const fields = fieldIds.length
			? await this.db.fieldDefinition.findMany({
					where: { id: { in: fieldIds } },
					select: {
						id: true,
						key: true,
						label: true,
						type: true,
						archivedAt: true,
					},
				})
			: [];
		return new Map(fields.map((field) => [field.id, field]));
	}

	async purgeExpired(before: Date): Promise<number> {
		let removed = 0;
		for (let batch = 0; batch < ARCHIVE.prune.auditMaxBatches; batch += 1) {
			const expired = await this.db.recordChange.findMany({
				where: { createdAt: { lt: before } },
				select: { id: true },
				take: ARCHIVE.prune.maxBatch,
			});
			if (expired.length === 0) break;
			const { count } = await this.db.recordChange.deleteMany({
				where: { id: { in: expired.map((row) => row.id) } },
			});
			removed += count;
			if (expired.length < ARCHIVE.prune.maxBatch) break;
		}
		return removed;
	}

	private async assertReferencesExist(
		revert: Extract<RevertPlan, { kind: "record" }>,
	) {
		const companyId =
			"companyId" in revert.plan ? revert.plan.companyId : undefined;
		const ownerId = revert.plan.ownerId;
		const [company, owner] = await Promise.all([
			companyId
				? this.db.company.findUnique({
						where: { id: companyId },
						select: { id: true },
					})
				: null,
			ownerId
				? this.db.user.findUnique({
						where: { id: ownerId },
						select: { id: true },
					})
				: null,
		]);
		const gone = [
			companyId && !company ? "the company" : null,
			ownerId && !owner ? "the owner" : null,
		].filter((name) => name !== null);
		if (gone.length)
			throw new TRPCError({
				code: "CONFLICT",
				message: `${gone.join(" and ")} it pointed to no longer exists. Nothing was undone.`,
			});
	}

	private async currentRow(entity: FieldEntity, recordId: string) {
		const rows =
			entity === "CONTACT"
				? await this.db
						.$queryRaw`SELECT to_jsonb(t) AS row FROM "contact" t WHERE t.id = ${recordId}`
				: entity === "COMPANY"
					? await this.db
							.$queryRaw`SELECT to_jsonb(t) AS row FROM "company" t WHERE t.id = ${recordId}`
					: await this.db
							.$queryRaw`SELECT to_jsonb(t) AS row FROM "deal" t WHERE t.id = ${recordId}`;
		return currentRows.parse(rows)[0]?.row ?? null;
	}
}
