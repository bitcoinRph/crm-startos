import {
	type Db,
	DealStage,
	type FieldEntity,
	type Prisma,
	type RecordChangeModel,
} from "@crm/db";
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

type RevertPlan =
	| {
			entity: "CONTACT";
			plan: z.infer<typeof contactRevert>;
	  }
	| {
			entity: "COMPANY";
			plan: z.infer<typeof companyRevert>;
	  }
	| {
			entity: "DEAL";
			plan: z.infer<typeof dealRevert>;
	  };

type ListInput = z.infer<typeof recordChangesListInput>;

function valuesOf(change: RecordChangeModel, side: "before" | "after") {
	const value = change[side];
	return value === null ? null : changeValues.parse(value);
}

function revertPlan(change: RecordChangeModel): RevertPlan | null {
	if (change.operation !== "UPDATE" || change.fieldId !== null) return null;
	const before = valuesOf(change, "before");
	if (!before) return null;
	if (change.entity === "CONTACT") {
		const parsed = contactRevert.safeParse(before);
		return parsed.success ? { entity: "CONTACT", plan: parsed.data } : null;
	}
	if (change.entity === "COMPANY") {
		const parsed = companyRevert.safeParse(before);
		return parsed.success ? { entity: "COMPANY", plan: parsed.data } : null;
	}
	const parsed = dealRevert.safeParse(before);
	return parsed.success ? { entity: "DEAL", plan: parsed.data } : null;
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

	async list(input: ListInput): Promise<RecordChangeOutput[]> {
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
		const fieldIds = [
			...new Set(rows.flatMap((row) => (row.fieldId ? [row.fieldId] : []))),
		];
		const fields = fieldIds.length
			? await this.db.fieldDefinition.findMany({
					where: { id: { in: fieldIds } },
					select: { id: true, label: true },
				})
			: [];
		const labels = new Map(fields.map((field) => [field.id, field.label]));
		return rows.map((row) => ({
			id: row.id,
			entity: row.entity,
			recordId: row.recordId,
			fieldId: row.fieldId,
			fieldLabel: row.fieldId ? (labels.get(row.fieldId) ?? null) : null,
			operation: row.operation,
			before: valuesOf(row, "before"),
			after: valuesOf(row, "after"),
			actorKind: row.actorKind,
			actorId: row.actorId,
			actorUserId: row.actorUserId,
			revertible: revertPlan(row) !== null,
			createdAt: row.createdAt.toISOString(),
		}));
	}

	async revert(id: string, actingUserId: string) {
		const change = await this.db.recordChange.findUnique({ where: { id } });
		if (!change)
			throw new TRPCError({ code: "NOT_FOUND", message: "No such change." });
		const revert = revertPlan(change);
		if (!revert)
			throw new TRPCError({
				code: "BAD_REQUEST",
				message:
					"This change cannot be undone here. Only edits to the record's own fields, its stage and archive can.",
			});
		const current = await this.currentRow(change.entity, change.recordId);
		if (!current)
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "The record no longer exists.",
			});
		const after: ChangeValues = valuesOf(change, "after") ?? {};
		const moved = Object.keys(after).filter(
			(key) => !sameValue(current[key], after[key]),
		);
		if (moved.length)
			throw new TRPCError({
				code: "CONFLICT",
				message: `${moved.join(", ")} changed again after this change. Nothing was undone.`,
			});
		await this.assertReferencesExist(revert);

		if (revert.entity === "CONTACT") {
			const { archivedAt, ...update } = revert.plan;
			if (Object.keys(update).length)
				await this.contacts.update(change.recordId, update);
			if (archivedAt === null) await this.contacts.restore(change.recordId);
			if (archivedAt) await this.contacts.archive(change.recordId);
		} else if (revert.entity === "COMPANY") {
			const { archivedAt, ...update } = revert.plan;
			if (Object.keys(update).length)
				await this.companies.update(change.recordId, update);
			if (archivedAt === null) await this.companies.restore(change.recordId);
			if (archivedAt) await this.companies.archive(change.recordId);
		} else {
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
			if (Object.keys(update).length)
				await this.deals.update(change.recordId, update);
			if (stage !== undefined)
				await this.deals.setStage(
					{
						id: change.recordId,
						stage,
						closedReason: closedReason ?? undefined,
					},
					actingUserId,
				);
			if (archivedAt === null) await this.deals.restore(change.recordId);
			if (archivedAt) await this.deals.archive(change.recordId);
		}
		return { entity: change.entity, recordId: change.recordId };
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

	private async assertReferencesExist(revert: RevertPlan) {
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
