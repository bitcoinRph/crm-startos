import type { CodexModel, CodexModelList } from "@crm/validation/codex";
import { z } from "zod";
import { CODEX } from "./config";
import {
	type CodexCredential,
	CodexUnavailableError,
	resolveCodexCredential,
} from "./connection";
import type { CodexFetch } from "./oauth";

const codexCatalog = z
	.object({
		models: z.array(
			z
				.object({
					slug: z.string().min(1),
					display_name: z.string().min(1).optional(),
					visibility: z.string().optional(),
					priority: z.number().optional(),
					context_window: z.number().int().positive().nullable().optional(),
				})
				.loose(),
		),
	})
	.loose();

const platformCatalog = z
	.object({ data: z.array(z.object({ id: z.string().min(1) }).loose()) })
	.loose();

async function chatgptModels(
	userId: string,
	credential: Extract<CodexCredential, { kind: "CHATGPT" }>,
	transport: CodexFetch,
): Promise<CodexModel[]> {
	const url = new URL(`${CODEX.backend.baseURL}${CODEX.backend.modelsPath}`);
	url.searchParams.set("client_version", CODEX.backend.clientVersion);
	const request = (token: string) =>
		transport(url, {
			method: "GET",
			headers: new Headers({
				Authorization: `Bearer ${token}`,
				"ChatGPT-Account-ID": credential.accountId,
				originator: CODEX.backend.originator,
				"User-Agent": CODEX.backend.userAgent,
				Accept: "application/json",
			}),
			redirect: "error",
			signal: AbortSignal.timeout(CODEX.backend.modelListTimeoutMs),
		});
	let response = await request(credential.accessToken);
	if (response.status === 401) {
		const renewed = await resolveCodexCredential(
			userId,
			transport,
			credential.accessToken,
		);
		if (renewed.kind !== "CHATGPT")
			throw new CodexUnavailableError("The Codex connection changed.");
		response = await request(renewed.accessToken);
	}
	if (!response.ok)
		throw new CodexUnavailableError(
			`OpenAI answered ${response.status} to the model list.`,
		);
	return codexCatalog
		.parse(await response.json())
		.models.filter((model) => model.visibility === "list")
		.sort(
			(a, b) =>
				(a.priority ?? Number.MAX_SAFE_INTEGER) -
					(b.priority ?? Number.MAX_SAFE_INTEGER) ||
				a.slug.localeCompare(b.slug),
		)
		.map((model) => ({
			id: model.slug,
			name: model.display_name ?? model.slug,
			contextWindowTokens: model.context_window ?? null,
		}));
}

async function platformModels(
	credential: Extract<CodexCredential, { kind: "API_KEY" }>,
	transport: CodexFetch,
): Promise<CodexModel[]> {
	const response = await transport(
		`${CODEX.platform.baseURL}${CODEX.platform.modelsPath}`,
		{
			method: "GET",
			headers: new Headers({ Authorization: `Bearer ${credential.apiKey}` }),
			redirect: "error",
			signal: AbortSignal.timeout(CODEX.platform.modelListTimeoutMs),
		},
	);
	if (!response.ok)
		throw new CodexUnavailableError(
			`OpenAI answered ${response.status} to the model list.`,
		);
	return platformCatalog
		.parse(await response.json())
		.data.map((model) => model.id)
		.sort()
		.map((id) => ({ id, name: id, contextWindowTokens: null }));
}

export async function listCodexModels(
	userId: string,
	transport: CodexFetch = fetch,
): Promise<CodexModelList> {
	try {
		const credential = await resolveCodexCredential(userId, transport);
		const models =
			credential.kind === "CHATGPT"
				? await chatgptModels(userId, credential, transport)
				: await platformModels(credential, transport);
		return { available: true, reason: null, models };
	} catch (error) {
		return {
			available: false,
			reason: error instanceof Error ? error.message : "The model list failed.",
			models: [],
		};
	}
}
