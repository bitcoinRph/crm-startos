import { z } from "zod";
import {
	extractSalesNote,
	type SalesExtractionModel,
} from "./sales-extraction";

const requestSchema = z.object({
	id: z.uuid(),
	source: z.string(),
	contactId: z.string(),
	profileId: z.string(),
	profileRevision: z.string(),
});

export async function processSalesRequest(
	raw: z.input<typeof requestSchema>,
	save: (proposal: {
		requestId: string;
		operations: Awaited<ReturnType<typeof extractSalesNote>>;
	}) => Promise<unknown>,
	model?: SalesExtractionModel,
) {
	const request = requestSchema.parse(raw);
	const operations = await extractSalesNote(
		{
			source: request.source,
			candidateIds: [request.contactId],
			profileId: request.profileId,
			profileRevision: request.profileRevision,
		},
		model,
	);
	if (!operations.length)
		throw new Error("No supported evidence. Human clarification required.");
	return save({ requestId: request.id, operations });
}
