import { z } from "zod";

export const approvedSalesProfile = {
	id: "qwen-local-experimental",
	revision: "sales-qwen-v1",
} as const;
export const salesRequestInput = z.strictObject({
	source: z
		.string()
		.min(1)
		.max(2048)
		.refine((value) => new TextEncoder().encode(value).length <= 2048),
	candidateIds: z.array(z.string().min(1)).length(1),
	expectedUpdatedAt: z.iso.datetime(),
	profileId: z.literal(approvedSalesProfile.id),
	profileRevision: z.literal(approvedSalesProfile.revision),
});
export const salesOperation = z.discriminatedUnion("type", [
	z.strictObject({
		type: z.literal("contact_fact"),
		contactId: z.string().min(1),
		field: z.literal("jobTitle"),
		value: z.string().min(1).max(500),
		evidence: z.string().min(1).max(500),
	}),
	z.strictObject({
		type: z.literal("create_note"),
		contactId: z.string().min(1),
		field: z.null(),
		value: z.string().min(1).max(20000),
		evidence: z.string().min(1).max(20000),
	}),
	z.strictObject({
		type: z.literal("create_task"),
		contactId: z.string().min(1),
		field: z.null(),
		value: z.string().min(1).max(20000),
		evidence: z.string().min(1).max(20000),
	}),
]);
export const salesOperations = z.array(salesOperation).min(1).max(3);
export const salesRequestIdInput = z.strictObject({ requestId: z.uuid() });
export const salesSubmitInput = z.strictObject({
	requestId: z.uuid(),
	operations: salesOperations,
});
export const salesApproveInput = z.strictObject({
	proposalId: z.uuid(),
	idempotencyKey: z.uuid(),
});
export type SalesRequestInput = z.infer<typeof salesRequestInput>;
export type SalesOperation = z.infer<typeof salesOperation>;
export function validateSalesOperations(
	source: string,
	contactId: string,
	value: unknown,
): SalesOperation[] {
	const operations = salesOperations.parse(value);
	const types = new Set<string>();
	for (const operation of operations) {
		if (
			operation.contactId !== contactId ||
			operation.value !== operation.evidence ||
			!source.includes(operation.evidence)
		)
			throw new Error("Sales evidence or contact does not match the request.");
		if (types.has(operation.type))
			throw new Error("Only one operation of each type is allowed.");
		types.add(operation.type);
	}
	return operations;
}
