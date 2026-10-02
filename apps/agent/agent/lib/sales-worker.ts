import { db, Prisma } from "@crm/db";
import { storeSalesProposal } from "@crm/db/sales";
import {
	profilesFor,
	type SalesProcessor,
	salesProfileOf,
	validateSalesOperations,
} from "@crm/validation/sales";
import { generateText, Output } from "ai";
import { z } from "zod";
import { createCodexModel } from "./codex/model";
import type { CodexFetch } from "./codex/oauth";
import { type CodexBinding, codexBindingFor } from "./codex/selection";
import { DISPATCH } from "./dispatch-config";
import { parseLocalConfig } from "./inference/local";
import {
	extractionOutput,
	type SalesExtractionModel,
} from "./sales-extraction";
import { processSalesRequest } from "./sales-workflow";

const claimedRow = z.object({
	id: z.string(),
	source: z.string(),
	contactId: z.string(),
	profileId: z.string(),
	profileRevision: z.string(),
	requestedById: z.string(),
});

type ClaimedRequest = z.infer<typeof claimedRow>;

const CRM_PROCESSORS = ["ollama", "codex"] as const satisfies SalesProcessor[];

export async function claimSalesRequests(
	limit: number = DISPATCH.sales.batch,
): Promise<ClaimedRequest[]> {
	const profileIds = CRM_PROCESSORS.flatMap((processor) =>
		profilesFor(processor).map((profile) => profile.id),
	);
	const leasedUntil = new Date(Date.now() + DISPATCH.sales.leaseMs);
	const rows = await db.$queryRaw`
		UPDATE "salesRequest" SET "leasedUntil" = ${leasedUntil}
		WHERE id IN (
			SELECT id FROM "salesRequest"
			WHERE status = 'PENDING'
				AND "profileId" IN (${Prisma.join(profileIds)})
				AND ("leasedUntil" IS NULL OR "leasedUntil" < now())
			ORDER BY "createdAt"
			LIMIT ${limit}
			FOR UPDATE SKIP LOCKED
		)
		RETURNING id::text, source, "contactId", "profileId", "profileRevision", "requestedById"`;
	return z.array(claimedRow).parse(rows);
}

export function codexExtractionModel(
	binding: CodexBinding,
	transport: CodexFetch = fetch,
): SalesExtractionModel {
	return async (request) => {
		const result = await generateText({
			model: createCodexModel(
				binding.userId,
				binding.modelId,
				binding.kind,
				transport,
			),
			system: request.system,
			prompt: request.prompt,
			abortSignal: request.abortSignal,
			maxRetries: 0,
			providerOptions: { openai: { strictJsonSchema: true } },
			output: Output.object({ schema: extractionOutput }),
		});
		if (result.finishReason !== "stop")
			throw new Error("SALES_EXTRACTION_INCOMPLETE");
		return result.output.operations;
	};
}

async function fail(requestId: string, message: string) {
	await db.salesRequest.updateMany({
		where: { id: requestId, status: "PENDING" },
		data: {
			status: "FAILED",
			leasedUntil: null,
			error: message.slice(0, DISPATCH.sales.maxErrorCharacters),
		},
	});
}

async function producer(
	request: ClaimedRequest,
	transport: CodexFetch,
): Promise<{ producedBy: string; model?: SalesExtractionModel }> {
	const profile = salesProfileOf(request.profileId, request.profileRevision);
	if (profile?.processor === "ollama") {
		const config = parseLocalConfig(process.env.CRM_LOCAL_INFERENCE_JSON);
		if (!config)
			throw new Error(
				"SALES_OLLAMA_UNAVAILABLE: Configure Local Inference before using the crm-ollama profile.",
			);
		return { producedBy: `crm-agent/ollama:${config.modelId}` };
	}
	if (profile?.processor === "codex") {
		const binding = await codexBindingFor(request.requestedById);
		if (!binding)
			throw new Error(
				"SALES_CODEX_UNAVAILABLE: The requester has no active Codex connection with a model selected.",
			);
		return {
			producedBy: `crm-agent/codex:${binding.modelId}`,
			model: codexExtractionModel(binding, transport),
		};
	}
	throw new Error("SALES_PROFILE_NOT_PROCESSED_IN_CRM");
}

export async function processClaimedSalesRequest(
	request: ClaimedRequest,
	transport: CodexFetch = fetch,
): Promise<"proposed" | "failed"> {
	try {
		const { producedBy, model } = await producer(request, transport);
		await processSalesRequest(
			request,
			(proposal) =>
				storeSalesProposal(
					db,
					{ ...proposal, proposedById: null, proposedByKeyId: null },
					validateSalesOperations,
				),
			producedBy,
			model,
		);
		return "proposed";
	} catch (error) {
		await fail(
			request.id,
			error instanceof Error ? error.message : String(error),
		);
		return "failed";
	}
}

export async function drainSalesRequests(
	transport: CodexFetch = fetch,
): Promise<void> {
	try {
		for (const request of await claimSalesRequests())
			await processClaimedSalesRequest(request, transport);
	} catch (error) {
		console.error(
			`[sales] could not drain sales requests: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
}
