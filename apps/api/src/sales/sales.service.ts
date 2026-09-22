import { randomUUID } from "node:crypto";
import type { Db } from "@crm/db";
import {
	salesApproveInput,
	salesRequestInput,
	salesSubmitInput,
	validateSalesOperations,
} from "@crm/validation/sales";
import { Injectable } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import { InjectDatabase } from "../database/database.constants";

export type SalesActor =
	| { userId: string; kind: "session"; sessionId: string }
	| { userId: string; kind: "apiKey"; keyId: string; scopes: string[] };
export const SALES_SCOPES = {
	read: "sales:read",
	write: "sales:proposal:write",
	approve: "sales:proposal:approve",
} as const;
export function requireSalesScope(actor: SalesActor, scope: string) {
	if (scope === SALES_SCOPES.approve && actor.kind !== "session")
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "Human session required.",
		});
	if (actor.kind === "apiKey" && !actor.scopes.includes(scope))
		throw new TRPCError({
			code: "FORBIDDEN",
			message: `Missing scope: ${scope}`,
		});
}

@Injectable()
export class SalesService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async createRequest<T>(actor: SalesActor, raw: T) {
		requireSalesScope(actor, SALES_SCOPES.write);
		requireSalesScope(actor, SALES_SCOPES.read);
		const input = salesRequestInput.parse(raw);
		const contact = await this.db.contact.findFirst({
			where: { id: input.candidateIds[0], archivedAt: null },
			select: {
				id: true,
				firstName: true,
				lastName: true,
				email: true,
				title: true,
				updatedAt: true,
			},
		});
		if (!contact)
			throw new TRPCError({ code: "NOT_FOUND", message: "Contact not found." });
		if (contact.updatedAt.toISOString() !== input.expectedUpdatedAt)
			throw new TRPCError({
				code: "CONFLICT",
				message: "Contact revision changed.",
			});
		return this.db.salesRequest.create({
			data: {
				id: randomUUID(),
				idempotencyKey: randomUUID(),
				source: input.source,
				contactId: contact.id,
				contactSnapshot: {
					...contact,
					updatedAt: contact.updatedAt.toISOString(),
				},
				expectedUpdatedAt: contact.updatedAt,
				profileId: input.profileId,
				profileRevision: input.profileRevision,
				requestedById: actor.userId,
				requestedByKeyId: actor.kind === "apiKey" ? actor.keyId : null,
				status: "PENDING",
			},
			include: { proposal: true },
		});
	}

	async getRequest(actor: SalesActor, requestId: string) {
		requireSalesScope(actor, SALES_SCOPES.read);
		const request = await this.db.salesRequest.findUnique({
			where: { id: requestId },
			include: { proposal: true },
		});
		if (!request) throw new TRPCError({ code: "NOT_FOUND" });
		return request;
	}

	async failRequest(actor: SalesActor, requestId: string) {
		requireSalesScope(actor, SALES_SCOPES.write);
		requireSalesScope(actor, SALES_SCOPES.read);
		await this.db.salesRequest.updateMany({
			where: { id: requestId, status: "PENDING" },
			data: {
				status: "FAILED",
				error:
					"Extraction failed or needs clarification. No CRM records changed.",
			},
		});
		return this.getRequest(actor, requestId);
	}

	async pendingRequests(actor: SalesActor) {
		requireSalesScope(actor, SALES_SCOPES.read);
		return this.db.salesRequest.findMany({
			where: { status: "PENDING" },
			orderBy: { createdAt: "asc" },
			take: 20,
		});
	}

	async storeProposal<T>(actor: SalesActor, raw: T) {
		requireSalesScope(actor, SALES_SCOPES.write);
		requireSalesScope(actor, SALES_SCOPES.read);
		const input = salesSubmitInput.parse(raw);
		return this.db.$transaction(async (tx) => {
			await tx.$queryRaw`SELECT id FROM "salesRequest" WHERE id = ${input.requestId}::uuid FOR UPDATE`;
			const request = await tx.salesRequest.findUnique({
				where: { id: input.requestId },
				include: { proposal: true },
			});
			if (!request) throw new TRPCError({ code: "NOT_FOUND" });
			let operations: ReturnType<typeof validateSalesOperations>;
			try {
				operations = validateSalesOperations(
					request.source,
					request.contactId,
					input.operations,
				);
			} catch {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Invalid sales operations or evidence.",
				});
			}
			if (request.proposal) {
				if (
					JSON.stringify(
						validateSalesOperations(
							request.source,
							request.contactId,
							request.proposal.operations,
						),
					) !== JSON.stringify(operations)
				)
					throw new TRPCError({
						code: "CONFLICT",
						message: "Proposal already exists.",
					});
				return request.proposal;
			}
			if (request.status !== "PENDING")
				throw new TRPCError({ code: "CONFLICT" });
			const proposal = await tx.salesProposal.create({
				data: {
					id: randomUUID(),
					idempotencyKey: randomUUID(),
					requestId: request.id,
					operations,
					proposedById: actor.userId,
					proposedByKeyId: actor.kind === "apiKey" ? actor.keyId : null,
					producedBy: input.producedBy,
				},
			});
			await tx.salesRequest.update({
				where: { id: request.id },
				data: { status: "PROPOSED" },
			});
			return proposal;
		});
	}

	async approveProposal<T>(actor: SalesActor, raw: T) {
		requireSalesScope(actor, SALES_SCOPES.approve);
		if (actor.kind !== "session") throw new TRPCError({ code: "FORBIDDEN" });
		const input = salesApproveInput.parse(raw);
		return this.db.$transaction(async (tx) => {
			const session = await tx.session.findFirst({
				where: {
					id: actor.sessionId,
					userId: actor.userId,
					expiresAt: { gt: new Date() },
				},
			});
			if (!session)
				throw new TRPCError({
					code: "UNAUTHORIZED",
					message: "Active human session required.",
				});
			await tx.$queryRaw`SELECT id FROM "salesProposal" WHERE id = ${input.proposalId}::uuid FOR UPDATE`;
			const proposal = await tx.salesProposal.findUnique({
				where: { id: input.proposalId },
				include: { request: true },
			});
			if (!proposal) throw new TRPCError({ code: "NOT_FOUND" });
			if (proposal.idempotencyKey !== input.idempotencyKey)
				throw new TRPCError({
					code: "CONFLICT",
					message: "Approval key mismatch.",
				});
			if (proposal.approvedAt) return proposal;
			const request = proposal.request;
			await tx.$queryRaw`SELECT id FROM "contact" WHERE id = ${request.contactId} FOR UPDATE`;
			const contact = await tx.contact.findFirst({
				where: { id: request.contactId, archivedAt: null },
			});
			if (
				!contact ||
				contact.updatedAt.getTime() !== request.expectedUpdatedAt.getTime()
			)
				throw new TRPCError({
					code: "CONFLICT",
					message: "Contact revision changed.",
				});
			const operations = validateSalesOperations(
				request.source,
				request.contactId,
				proposal.operations,
			);
			const now = new Date(
				Math.max(Date.now(), contact.updatedAt.getTime() + 1),
			);
			const appliedActivityIds: string[] = [];
			for (const operation of operations) {
				if (operation.type === "contact_fact") {
					await tx.contact.update({
						where: { id: contact.id },
						data: { title: operation.value, updatedAt: now },
					});
				} else {
					const activity = await tx.activity.create({
						data: {
							id: randomUUID(),
							type: operation.type === "create_note" ? "NOTE" : "TASK",
							subject:
								operation.type === "create_task" ? operation.value : null,
							body: operation.value,
							contactId: contact.id,
							companyId: contact.companyId,
							createdById: actor.userId,
							occurredAt: operation.type === "create_note" ? now : null,
							meta: {
								salesProposalId: proposal.id,
								salesRequestId: request.id,
								evidence: operation.evidence,
							},
						},
					});
					appliedActivityIds.push(activity.id);
				}
			}
			await tx.contact.update({
				where: { id: contact.id },
				data: {
					updatedAt: now,
					lastActivityAt: appliedActivityIds.length
						? now
						: contact.lastActivityAt,
				},
			});
			if (contact.companyId && appliedActivityIds.length)
				await tx.company.updateMany({
					where: {
						id: contact.companyId,
						OR: [{ lastActivityAt: null }, { lastActivityAt: { lt: now } }],
					},
					data: { lastActivityAt: now },
				});
			await tx.salesRequest.update({
				where: { id: request.id },
				data: { status: "APPROVED" },
			});
			return tx.salesProposal.update({
				where: { id: proposal.id },
				data: {
					approvedAt: now,
					approvedById: actor.userId,
					approvedSessionId: actor.sessionId,
					appliedActivityIds,
				},
			});
		});
	}
}
