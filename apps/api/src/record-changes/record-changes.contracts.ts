import { z } from "zod";
import { RECORD_CHANGES } from "./record-changes-config";

const recordEntity = z.enum(["COMPANY", "CONTACT", "DEAL"]);

export const changeValue = z.union([
	z.string(),
	z.number(),
	z.boolean(),
	z.null(),
]);
export type ChangeValue = z.infer<typeof changeValue>;
export const changeValues = z.record(z.string(), changeValue);
export type ChangeValues = z.infer<typeof changeValues>;

export const recordChangesListInput = z.strictObject({
	entity: recordEntity.optional(),
	recordId: z.string().trim().min(1).max(64).optional(),
	apiKeyId: z.string().trim().min(1).max(64).optional(),
	limit: z
		.number()
		.int()
		.min(1)
		.max(RECORD_CHANGES.list.maxLimit)
		.default(RECORD_CHANGES.list.defaultLimit),
});

export const recordChangeOutput = z.object({
	id: z.string(),
	entity: recordEntity,
	recordId: z.string(),
	fieldId: z.string().nullable(),
	fieldLabel: z.string().nullable(),
	operation: z.enum(["CREATE", "UPDATE"]),
	before: changeValues.nullable(),
	after: changeValues.nullable(),
	valuesHidden: z.boolean(),
	actorKind: z.enum(["USER", "API_KEY", "AGENT", "SYSTEM"]),
	actorId: z.string().nullable(),
	actorUserId: z.string().nullable(),
	revertible: z.boolean(),
	createdAt: z.iso.datetime(),
});
export type RecordChangeOutput = z.infer<typeof recordChangeOutput>;

export const recordChangesListOutput = z.array(recordChangeOutput);

export const recordChangeRevertInput = z.strictObject({ id: z.uuid() });
export const recordChangeForgetInput = z.strictObject({ id: z.uuid() });
export const recordChangeForgetOutput = z.object({ id: z.string() });

export const recordChangeRevertOutput = z.object({
	entity: recordEntity,
	recordId: z.string(),
});
