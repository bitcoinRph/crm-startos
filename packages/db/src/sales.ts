import { randomUUID } from "node:crypto";
import type { Db } from "./client";
import type { Prisma } from "./generated/prisma/client";

export type SalesStoreFailure = "NOT_FOUND" | "BAD_REQUEST" | "CONFLICT";

export class SalesStoreError extends Error {
	constructor(
		readonly code: SalesStoreFailure,
		message: string,
	) {
		super(message);
		this.name = "SalesStoreError";
	}
}

export type SalesProposalDraft<T> = {
	requestId: string;
	operations: T;
	producedBy: string;
	proposedById: string | null;
	proposedByKeyId: string | null;
};

export async function storeSalesProposal<T extends Prisma.InputJsonValue>(
	db: Db,
	draft: SalesProposalDraft<Prisma.InputJsonValue>,
	validate: (
		source: string,
		contactId: string,
		value: Prisma.JsonValue | Prisma.InputJsonValue,
	) => T,
) {
	return db.$transaction(async (tx) => {
		await tx.$queryRaw`SELECT id FROM "salesRequest" WHERE id = ${draft.requestId}::uuid FOR UPDATE`;
		const request = await tx.salesRequest.findUnique({
			where: { id: draft.requestId },
			include: { proposal: true },
		});
		if (!request) throw new SalesStoreError("NOT_FOUND", "Request not found.");
		let operations: T;
		try {
			operations = validate(
				request.source,
				request.contactId,
				draft.operations,
			);
		} catch {
			throw new SalesStoreError(
				"BAD_REQUEST",
				"Invalid sales operations or evidence.",
			);
		}
		if (request.proposal) {
			if (
				JSON.stringify(
					validate(
						request.source,
						request.contactId,
						request.proposal.operations,
					),
				) !== JSON.stringify(operations)
			)
				throw new SalesStoreError("CONFLICT", "Proposal already exists.");
			return request.proposal;
		}
		if (request.status !== "PENDING")
			throw new SalesStoreError("CONFLICT", "Request is not pending.");
		const proposal = await tx.salesProposal.create({
			data: {
				id: randomUUID(),
				idempotencyKey: randomUUID(),
				requestId: request.id,
				operations,
				proposedById: draft.proposedById,
				proposedByKeyId: draft.proposedByKeyId,
				producedBy: draft.producedBy,
			},
		});
		await tx.salesRequest.update({
			where: { id: request.id },
			data: { status: "PROPOSED", leasedUntil: null },
		});
		return proposal;
	});
}
