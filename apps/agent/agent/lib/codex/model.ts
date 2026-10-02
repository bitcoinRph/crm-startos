import { createOpenAI } from "@ai-sdk/openai";
import type {
	LanguageModelV4,
	LanguageModelV4CallOptions,
} from "@ai-sdk/provider";
import { z } from "zod";
import { CODEX } from "./config";
import {
	type CodexCredential,
	CodexUnavailableError,
	resolveCodexCredential,
} from "./connection";
import type { CodexFetch } from "./oauth";
import { generateFromStream } from "./stream";

export type CodexKind = CodexCredential["kind"];

const requestBody = z.looseObject({
	instructions: z.string().nullish(),
	input: z.array(z.json()).default([]),
});

const instructionItem = z.looseObject({
	role: z.enum(["system", "developer"]),
	content: z.union([
		z.string(),
		z
			.array(z.looseObject({ text: z.string() }))
			.transform((parts) => parts.map((part) => part.text).join("\n")),
	]),
});

const requestText = z.string();

export function codexRequestBody(raw: string): string {
	const body = requestBody.parse(JSON.parse(raw));
	const instructions = body.instructions?.trim() ? [body.instructions] : [];
	const input: z.infer<typeof requestBody>["input"] = [];
	for (const item of body.input) {
		const parsed = instructionItem.safeParse(item);
		if (parsed.success) instructions.push(parsed.data.content);
		else input.push(item);
	}
	const kept = Object.fromEntries(
		Object.entries(body).filter(([key]) =>
			CODEX.backend.requestKeys.some((allowed) => allowed === key),
		),
	);
	return JSON.stringify({
		...kept,
		instructions:
			instructions.filter((text) => text.trim()).join("\n\n") ||
			CODEX.backend.defaultInstructions,
		input,
		store: false,
		stream: true,
	});
}

function codexHeaders(
	init: RequestInit | undefined,
	credential: Extract<CodexCredential, { kind: "CHATGPT" }>,
): Headers {
	const headers = new Headers(init?.headers);
	headers.delete("openai-organization");
	headers.delete("openai-project");
	headers.set("Authorization", `Bearer ${credential.accessToken}`);
	headers.set("ChatGPT-Account-ID", credential.accountId);
	headers.set("originator", CODEX.backend.originator);
	headers.set("User-Agent", CODEX.backend.userAgent);
	headers.set("Accept", "text/event-stream");
	return headers;
}

function changed(): never {
	throw new CodexUnavailableError(
		"The Codex connection changed. Start a new conversation.",
	);
}

function chatgpt(
	credential: CodexCredential,
): Extract<CodexCredential, { kind: "CHATGPT" }> {
	return credential.kind === "CHATGPT" ? credential : changed();
}

function platformKey(
	credential: CodexCredential,
): Extract<CodexCredential, { kind: "API_KEY" }> {
	return credential.kind === "API_KEY" ? credential : changed();
}

function platformOptions(
	options: LanguageModelV4CallOptions,
): LanguageModelV4CallOptions {
	return {
		...options,
		providerOptions: {
			...options.providerOptions,
			openai: { ...options.providerOptions?.openai, store: false },
		},
	};
}

function codexOptions(
	options: LanguageModelV4CallOptions,
): LanguageModelV4CallOptions {
	return {
		...options,
		providerOptions: {
			...options.providerOptions,
			openai: {
				...options.providerOptions?.openai,
				store: false,
				include: ["reasoning.encrypted_content"],
			},
		},
	};
}

export function createCodexModel(
	userId: string,
	modelId: string,
	kind: CodexKind,
	transport: CodexFetch = fetch,
): LanguageModelV4 {
	if (kind === "API_KEY") {
		const endpoint = `${CODEX.platform.baseURL}${CODEX.platform.responsesPath}`;
		const provider = createOpenAI({
			baseURL: CODEX.platform.baseURL,
			apiKey: "resolved-per-request",
			name: "crm.openai",
			fetch: async (input, init) => {
				if (String(input) !== endpoint)
					throw new Error("CODEX_DESTINATION_DENIED");
				const credential = platformKey(
					await resolveCodexCredential(userId, transport),
				);
				const headers = new Headers(init?.headers);
				headers.set("Authorization", `Bearer ${credential.apiKey}`);
				return transport(input, { ...init, headers, redirect: "error" });
			},
		}).responses(modelId);
		return {
			specificationVersion: "v4",
			provider: provider.provider,
			modelId: provider.modelId,
			supportedUrls: {},
			doGenerate: (options) => provider.doGenerate(platformOptions(options)),
			doStream: (options) => provider.doStream(platformOptions(options)),
		};
	}
	const endpoint = `${CODEX.backend.baseURL}${CODEX.backend.responsesPath}`;
	const provider = createOpenAI({
		baseURL: CODEX.backend.baseURL,
		apiKey: "resolved-per-request",
		name: "crm.codex",
		fetch: async (input, init) => {
			if (String(input) !== endpoint)
				throw new Error("CODEX_DESTINATION_DENIED");
			const raw = requestText.safeParse(init?.body);
			if (!raw.success) throw new Error("CODEX_REQUEST_UNREADABLE");
			const body = codexRequestBody(raw.data);
			const send = (
				credential: Extract<CodexCredential, { kind: "CHATGPT" }>,
			) =>
				transport(input, {
					...init,
					body,
					headers: codexHeaders(init, credential),
					redirect: "error",
				});
			const credential = chatgpt(
				await resolveCodexCredential(userId, transport),
			);
			const response = await send(credential);
			if (response.status !== 401) return response;
			await response.body?.cancel();
			const renewed = chatgpt(
				await resolveCodexCredential(userId, transport, credential.accessToken),
			);
			return send(renewed);
		},
	}).responses(modelId);
	const stream = (options: LanguageModelV4CallOptions) =>
		provider.doStream(codexOptions(options));
	return {
		specificationVersion: "v4",
		provider: provider.provider,
		modelId: provider.modelId,
		supportedUrls: {},
		doGenerate: async (options) => generateFromStream(await stream(options)),
		doStream: stream,
	};
}
