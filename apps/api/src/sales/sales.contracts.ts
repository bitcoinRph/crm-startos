import { salesOperations } from "@crm/validation/sales";
import { z } from "zod";
import { SALES } from "./sales-config";

export const salesProposalOutput = z.object({
	id: z.uuid(),
	requestId: z.uuid(),
	idempotencyKey: z.uuid(),
	operations: salesOperations,
	proposedById: z.string().nullable(),
	proposedByKeyId: z.string().nullable(),
	producedBy: z.string().nullable(),
	createdAt: z.string(),
	approvedAt: z.string().nullable(),
	approvedById: z.string().nullable(),
	approvedSessionId: z.string().nullable(),
	appliedActivityIds: z.array(z.string()),
	rejectedAt: z.string().nullable(),
	rejectedById: z.string().nullable(),
	rejectedSessionId: z.string().nullable(),
	rejectionReason: z.string().nullable(),
});
export const salesRequestOutput = z.object({
	id: z.uuid(),
	idempotencyKey: z.uuid(),
	source: z.string(),
	contactId: z.string(),
	contactSnapshot: z.object({
		id: z.string(),
		firstName: z.string(),
		lastName: z.string().nullable(),
		email: z.string().nullable(),
		title: z.string().nullable(),
		updatedAt: z.string(),
	}),
	expectedUpdatedAt: z.string(),
	profileId: z.string(),
	profileRevision: z.string(),
	requestedById: z.string(),
	requestedByKeyId: z.string().nullable(),
	status: z.enum(["PENDING", "PROPOSED", "APPROVED", "REJECTED", "FAILED"]),
	error: z.string().nullable(),
	createdAt: z.string(),
	proposal: salesProposalOutput.nullable().optional(),
});
export const salesPendingOutput = z.array(salesRequestOutput);
export const salesPendingInput = z.strictObject({});
export const salesReviewQueueInput = z.strictObject({
	limit: z
		.number()
		.int()
		.min(1)
		.max(SALES.reviewQueue.maxLimit)
		.default(SALES.reviewQueue.defaultLimit),
});
export const salesReviewQueueOutput = z.object({
	rows: z.array(salesRequestOutput),
	counts: z.object({ pending: z.number(), proposed: z.number() }),
});
export function salesWire<T>(value: T): unknown {
	return JSON.parse(JSON.stringify(value));
}
