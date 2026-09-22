import { describe, expect, test } from "bun:test";
import { generateText, stepCountIs, streamText, tool } from "ai";
import { z } from "zod";
import {
	createLocalInference as createActualLocalInference,
	type LocalConfig,
	type LocalFetch,
	parseLocalConfig,
	selectionIdentity,
} from "../agent/lib/inference/local";

const config = {
	baseURL: "http://127.0.0.1:11434/v1",
	modelId: "qwen3.5:4b",
	contextWindowTokens: 4096,
	maxOutputTokens: 1024,
};

function createLocalInference(
	config: LocalConfig | null,
	transport: LocalFetch,
) {
	return createActualLocalInference(config, async (url, init) => {
		if (String(url).endsWith("/api/version"))
			return Response.json({ version: "0.34.0" });
		if (String(url).endsWith("/api/ps"))
			return Response.json({
				models: [{ name: config?.modelId, context_length: 4096 }],
			});
		return transport(url, init);
	});
}

function completion(content = "synthetic answer") {
	return Response.json({
		id: "synthetic",
		object: "chat.completion",
		created: 1,
		model: config.modelId,
		choices: [
			{
				index: 0,
				message: { role: "assistant", content },
				finish_reason: "stop",
			},
		],
		usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
	});
}

describe("local inference", () => {
	test("tool calls round-trip through Chat Completions", async () => {
		const requests: string[] = [];
		let toolCalls = 0;
		const inference = createLocalInference(config, async (_url, init) => {
			requests.push(String(init?.body));
			if (requests.length > 1) return completion("tool complete");
			return Response.json({
				id: "tool",
				object: "chat.completion",
				created: 1,
				model: config.modelId,
				choices: [
					{
						index: 0,
						message: {
							role: "assistant",
							content: null,
							tool_calls: [
								{
									id: "fixture-call",
									type: "function",
									function: { name: "lookup", arguments: '{"id":"synthetic"}' },
								},
							],
						},
						finish_reason: "tool_calls",
					},
				],
			});
		});
		const result = await generateText({
			model: inference.model,
			prompt: "synthetic",
			maxRetries: 0,
			stopWhen: stepCountIs(2),
			tools: {
				lookup: tool({
					inputSchema: z.object({ id: z.string() }),
					execute: async ({ id }) => {
						toolCalls++;
						return { id, found: true };
					},
				}),
			},
		});
		expect(result.text).toBe("tool complete");
		expect(toolCalls).toBe(1);
		expect(requests).toHaveLength(2);
		expect(JSON.parse(requests[1] ?? "null").messages).toContainEqual({
			role: "tool",
			tool_call_id: "fixture-call",
			content: '{"id":"synthetic","found":true}',
		});
	});

	test("cancellation reaches the transport", async () => {
		const controller = new AbortController();
		let signal: AbortSignal | null | undefined;
		const inference = createLocalInference(config, async (_url, init) => {
			signal = init?.signal;
			controller.abort();
			signal?.throwIfAborted();
			return completion();
		});
		await expect(
			generateText({
				model: inference.model,
				prompt: "synthetic",
				abortSignal: controller.signal,
				maxRetries: 0,
			}),
		).rejects.toThrow();
		expect(signal?.aborted).toBe(true);
	});
	test("parses explicit configuration without cloud defaults", () => {
		expect(parseLocalConfig(JSON.stringify(config))).toEqual(config);
		expect(parseLocalConfig(undefined)).toBeNull();
		for (const baseURL of [
			"https://api.openai.com/v1",
			"http://user:secret@127.0.0.1:11434/v1",
			"http://127.0.0.1:11434/v1?key=x",
			"http://169.254.169.254/v1",
			"file:///v1",
		]) {
			expect(() =>
				parseLocalConfig(JSON.stringify({ ...config, baseURL })),
			).toThrow();
		}
		expect(() =>
			parseLocalConfig(
				JSON.stringify({ ...config, contextWindowTokens: 1000000 }),
			),
		).toThrow();
		expect(() =>
			parseLocalConfig(JSON.stringify({ ...config, maxOutputTokens: 8192 })),
		).toThrow();
	});

	test("identity changes with endpoint and token budgets", () => {
		expect(selectionIdentity(config)).toStartWith("local:");
		expect(selectionIdentity({ ...config, maxOutputTokens: 512 })).not.toBe(
			selectionIdentity(config),
		);
	});

	test("sends generation and compaction-style generation only to the approved chat endpoint", async () => {
		const requests: {
			url: string;
			body: string;
			auth: string | null;
			redirect: RequestRedirect | undefined;
		}[] = [];
		const inference = createLocalInference(config, async (url, init) => {
			requests.push({
				url: String(url),
				body: String(init?.body),
				auth: new Headers(init?.headers).get("authorization"),
				redirect: init?.redirect,
			});
			return completion();
		});
		for (const prompt of [
			"synthetic question",
			"Summarize this synthetic conversation.",
		]) {
			expect(
				(await generateText({ model: inference.model, prompt, maxRetries: 0 }))
					.text,
			).toBe("synthetic answer");
		}
		expect(requests).toHaveLength(2);
		for (const request of requests) {
			expect(request.url).toBe(`${config.baseURL}/chat/completions`);
			expect(request.auth).toBeNull();
			expect(request.redirect).toBe("error");
			const body = JSON.parse(request.body);
			expect(body.model).toBe(config.modelId);
			expect(body.reasoning_effort).toBe("none");
			expect(body.max_tokens ?? body.max_completion_tokens).toBe(
				config.maxOutputTokens,
			);
		}
	});

	test("streams through the public provider", async () => {
		const chunks = [
			{
				id: "s",
				created: 1,
				model: config.modelId,
				choices: [
					{
						index: 0,
						delta: { role: "assistant", content: "local" },
						finish_reason: null,
					},
				],
			},
			{
				id: "s",
				created: 1,
				model: config.modelId,
				choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
			},
		];
		const inference = createLocalInference(
			config,
			async () =>
				new Response(
					`${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`,
					{ headers: { "content-type": "text/event-stream" } },
				),
		);
		expect(
			await streamText({
				model: inference.model,
				prompt: "synthetic",
				maxRetries: 0,
			}).text,
		).toBe("local");
	});

	test("disabled configuration refuses both provider methods without network", async () => {
		let calls = 0;
		const inference = createLocalInference(null, async () => {
			calls++;
			return completion();
		});
		const input = {
			prompt: [
				{
					role: "user" as const,
					content: [{ type: "text" as const, text: "synthetic" }],
				},
			],
		};
		await expect(inference.model.doGenerate(input)).rejects.toThrow(
			"INFERENCE_UNAVAILABLE",
		);
		await expect(inference.model.doStream(input)).rejects.toThrow(
			"INFERENCE_UNAVAILABLE",
		);
		expect(calls).toBe(0);
	});

	test("a failed local request never falls back", async () => {
		const urls: string[] = [];
		const inference = createLocalInference(config, async (url) => {
			urls.push(String(url));
			return new Response("unavailable", { status: 503 });
		});
		await expect(
			generateText({
				model: inference.model,
				prompt: "synthetic",
				maxRetries: 0,
			}),
		).rejects.toThrow();
		expect(urls).toEqual([`${config.baseURL}/chat/completions`]);
	});
});
