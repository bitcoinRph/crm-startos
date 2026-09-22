import { expect, test } from "bun:test";
import { generateText, Output, streamText } from "ai";
import { z } from "zod";
import {
	createLocalInference,
	type LocalFetch,
	parseLocalConfig,
} from "../agent/lib/inference/local";

const config = {
	baseURL: "http://127.0.0.1:11434/v1",
	modelId: "qwen3.5:4b",
	contextWindowTokens: 4096,
	maxOutputTokens: 1024,
};
const input = {
	prompt: [
		{
			role: "user" as const,
			content: [{ type: "text" as const, text: "synthetic" }],
		},
	],
};

test("rejects unverified larger metadata and oversized output budgets", () => {
	for (const change of [
		{ contextWindowTokens: 8192 },
		{ contextWindowTokens: 32768 },
		{ maxOutputTokens: 1025 },
	])
		expect(() =>
			parseLocalConfig(JSON.stringify({ ...config, ...change })),
		).toThrow();
});

test("missing, smaller, malformed or ambiguous runner allocation denies both methods before content leaves", async () => {
	for (const models of [
		[],
		[{ name: config.modelId, context_length: 2048 }],
		[{ name: "other", context_length: 8192 }],
		[{ name: config.modelId }],
		[
			{ name: config.modelId, context_length: 4096 },
			{ name: config.modelId, context_length: 4096 },
		],
	]) {
		const urls: string[] = [];
		const transport: LocalFetch = async (url, init) => {
			urls.push(String(url));
			expect(init?.body).toBeUndefined();
			expect(new Headers(init?.headers).get("authorization")).toBeNull();
			expect(init?.redirect).toBe("error");
			return Response.json(
				String(url).endsWith("/api/version")
					? { version: "0.34.0" }
					: { models },
			);
		};
		const { model } = createLocalInference(config, transport);
		await expect(model.doGenerate(input)).rejects.toThrow();
		await expect(model.doStream(input)).rejects.toThrow();
		expect(urls.some((url) => url.endsWith("/chat/completions"))).toBe(false);
	}
});

test("unknown version and failed verification fail closed", async () => {
	for (const [response, message] of [
		[Response.json({ version: "0.35.0" }), "Ollama 0.35.0 is not a verified"],
		[
			new Response("down", { status: 503 }),
			"LOCAL_INFERENCE_VERIFICATION_FAILED",
		],
	] as const) {
		const urls: string[] = [];
		const { model } = createLocalInference(config, async (url) => {
			urls.push(String(url));
			return response.clone();
		});
		await expect(model.doGenerate(input)).rejects.toThrow(message);
		expect(urls).toEqual(["http://127.0.0.1:11434/api/version"]);
	}
});

test("checks allocation on every request instead of caching stale runner state", async () => {
	let checks = 0;
	let completions = 0;
	const { model } = createLocalInference(config, async (url) => {
		if (String(url).endsWith("/api/version"))
			return Response.json({ version: "0.34.0" });
		if (String(url).endsWith("/api/ps"))
			return Response.json({
				models: [
					{
						name: config.modelId,
						context_length: ++checks === 1 ? 4096 : 2048,
					},
				],
			});
		completions++;
		return Response.json({
			id: "test",
			created: 1,
			model: config.modelId,
			choices: [
				{
					index: 0,
					message: { role: "assistant", content: "ok" },
					finish_reason: "stop",
				},
			],
		});
	});
	await model.doGenerate(input);
	await expect(model.doGenerate(input)).rejects.toThrow(
		"LOCAL_INFERENCE_CONTEXT_UNVERIFIED",
	);
	expect(completions).toBe(1);
});

test("strict JSON and streaming force no thinking and cap caller provider overrides", async () => {
	const requestBody = z
		.object({
			stream: z.boolean().optional(),
			reasoning_effort: z.string().optional(),
			max_tokens: z.number().optional(),
			max_completion_tokens: z.number().optional(),
		})
		.loose();
	const bodies: z.infer<typeof requestBody>[] = [];
	const { model } = createLocalInference(config, async (url, init) => {
		if (String(url).endsWith("/api/version"))
			return Response.json({ version: "0.34.0" });
		if (String(url).endsWith("/api/ps"))
			return Response.json({
				models: [{ name: config.modelId, context_length: 4096 }],
			});
		const body = requestBody.parse(JSON.parse(String(init?.body)));
		bodies.push(body);
		if (body.stream)
			return new Response(
				`data: ${JSON.stringify({ id: "s", created: 1, model: config.modelId, choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
				{ headers: { "content-type": "text/event-stream" } },
			);
		return Response.json({
			id: "test",
			created: 1,
			model: config.modelId,
			choices: [
				{
					index: 0,
					message: {
						role: "assistant",
						content: '{"company":"Example Lantern LLC"}',
					},
					finish_reason: "stop",
				},
			],
		});
	});
	const options = {
		model,
		prompt: "synthetic",
		maxRetries: 0,
		maxOutputTokens: 9000,
		providerOptions: {
			openai: {
				reasoningEffort: "high",
				maxCompletionTokens: 9000,
				strictJsonSchema: false,
			},
		},
	};
	const result = await generateText({
		...options,
		output: Output.object({
			schema: z.object({ company: z.string() }).strict(),
		}),
	});
	expect(result.output.company).toBe("Example Lantern LLC");
	expect(await streamText(options).text).toBe("ok");
	for (const body of bodies) {
		expect(body.reasoning_effort).toBe("none");
		expect(body.max_tokens).toBe(1024);
		expect(body.max_completion_tokens).toBeUndefined();
	}
	expect(bodies[0]?.response_format).toMatchObject({
		type: "json_schema",
		json_schema: { strict: true },
	});
});
