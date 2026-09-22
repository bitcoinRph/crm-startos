import { createHash } from "node:crypto";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { z } from "zod";
import {
	isVerifiedRunnerVersion,
	LOCAL_INFERENCE,
	unverifiedRunnerVersion,
} from "./config";

function allowedLocalHosts(): Set<string> {
	return new Set([
		"localhost",
		"127.0.0.1",
		"[::1]",
		...(process.env.CRM_LOCAL_INFERENCE_ALLOWED_HOSTS ?? "")
			.split(",")
			.map((host) => host.trim())
			.filter(Boolean),
	]);
}

const localConfig = z
	.object({
		baseURL: z
			.string()
			.url()
			.refine((value) => {
				const url = new URL(value);
				return (
					["http:", "https:"].includes(url.protocol) &&
					allowedLocalHosts().has(url.hostname) &&
					!url.username &&
					!url.password &&
					!url.search &&
					!url.hash &&
					url.pathname === "/v1" &&
					value === url.href
				);
			}, "Use an approved local /v1 endpoint without credentials or query parameters."),
		modelId: z
			.string()
			.min(1)
			.max(200)
			.regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/),
		contextWindowTokens: z
			.number()
			.int()
			.refine(
				(value): boolean => value === LOCAL_INFERENCE.contextWindowTokens,
			),
		maxOutputTokens: z.number().int().min(1).max(1024),
	})
	.strict()
	.refine((value) => value.maxOutputTokens < value.contextWindowTokens);

export type LocalConfig = z.infer<typeof localConfig>;
export type LocalFetch = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;

export function parseLocalConfig(
	value: string | undefined,
): LocalConfig | null {
	return value ? localConfig.parse(JSON.parse(value)) : null;
}

export function selectionIdentity(config: LocalConfig): string {
	return `local:${createHash("sha256")
		.update(
			JSON.stringify({
				profile: LOCAL_INFERENCE.profile,
				config: localConfig.parse(config),
			}),
		)
		.digest("hex")}`;
}

export function unavailableModel(): LanguageModelV4 {
	return {
		specificationVersion: "v4",
		provider: "crm.local.disabled",
		modelId: "local-inference-unavailable",
		supportedUrls: {},
		doGenerate: async () => {
			throw new Error(
				"INFERENCE_UNAVAILABLE: No model is available to this conversation in the current inference mode. Start a new conversation.",
			);
		},
		doStream: async () => {
			throw new Error(
				"INFERENCE_UNAVAILABLE: No model is available to this conversation in the current inference mode. Start a new conversation.",
			);
		},
	};
}

export function createLocalInference(
	config: LocalConfig | null,
	transport: LocalFetch = fetch,
	authorize: () => void = () => {},
) {
	if (!config)
		return {
			model: unavailableModel(),
			modelContextWindowTokens: LOCAL_INFERENCE.contextWindowTokens,
		};
	const approved = localConfig.parse(config);
	const endpoint = `${approved.baseURL}/chat/completions`;
	const origin = new URL(approved.baseURL).origin;
	const runnerState = z.object({
		models: z.array(
			z.object({ name: z.string(), context_length: z.number().int() }),
		),
	});
	const verifyRunner = async (signal: AbortSignal) => {
		for (const path of ["/api/version", "/api/ps"]) {
			authorize();
			const response = await transport(`${origin}${path}`, {
				method: "GET",
				headers: new Headers(),
				signal,
				redirect: "error",
			});
			if (!response.ok) throw new Error("LOCAL_INFERENCE_VERIFICATION_FAILED");
			const data = await response.json();
			if (path === "/api/version") {
				const { version } = z.object({ version: z.string() }).parse(data);
				if (isVerifiedRunnerVersion(version)) continue;
				throw new Error(
					`LOCAL_INFERENCE_VERSION_UNVERIFIED: ${unverifiedRunnerVersion(version)}`,
				);
			}
			const selected = runnerState
				.parse(data)
				.models.filter((entry) => entry.name === approved.modelId);
			if (
				selected.length !== 1 ||
				(selected[0]?.context_length ?? 0) < approved.contextWindowTokens
			)
				throw new Error(
					"LOCAL_INFERENCE_CONTEXT_UNVERIFIED: Operator must load and verify the selected runner.",
				);
		}
	};
	const provider = createOpenAI({
		baseURL: approved.baseURL,
		apiKey: "local-keyless",
		name: "crm.local",
		fetch: async (input, init) => {
			authorize();
			if (String(input) !== endpoint)
				throw new Error("LOCAL_INFERENCE_DESTINATION_DENIED");
			const headers = new Headers(init?.headers);
			headers.delete("authorization");
			const timeout = AbortSignal.timeout(LOCAL_INFERENCE.requestTimeoutMs);
			const signal = init?.signal
				? AbortSignal.any([init.signal, timeout])
				: timeout;
			await verifyRunner(signal);
			authorize();
			return transport(input, { ...init, headers, signal, redirect: "error" });
		},
	}).chat(approved.modelId);
	const model: LanguageModelV4 = {
		specificationVersion: "v4",
		provider: provider.provider,
		modelId: provider.modelId,
		supportedUrls: {},
		doGenerate: async (options) => {
			authorize();
			return provider.doGenerate({
				...options,
				providerOptions: {
					openai: { reasoningEffort: "none", strictJsonSchema: true },
				},
				maxOutputTokens: Math.min(
					options.maxOutputTokens ?? approved.maxOutputTokens,
					approved.maxOutputTokens,
				),
			});
		},
		doStream: async (options) => {
			authorize();
			return provider.doStream({
				...options,
				providerOptions: {
					openai: { reasoningEffort: "none", strictJsonSchema: true },
				},
				maxOutputTokens: Math.min(
					options.maxOutputTokens ?? approved.maxOutputTokens,
					approved.maxOutputTokens,
				),
			});
		},
	};
	return { model, modelContextWindowTokens: approved.contextWindowTokens };
}
