import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { z } from "zod";
import { processSalesRequest } from "../agent/lib/sales-workflow";

const modelId = "qwen3.5:4b";
const contactId = "contact-mock";
const source = "Head of Procurement. Send the revised quote. Prefers email.";
const operations = [
	{
		type: "contact_fact",
		contactId,
		field: "jobTitle",
		value: "Head of Procurement",
		evidence: "Head of Procurement",
	},
	{
		type: "create_task",
		contactId,
		field: null,
		value: "Send the revised quote",
		evidence: "Send the revised quote",
	},
	{
		type: "create_note",
		contactId,
		field: null,
		value: "Prefers email",
		evidence: "Prefers email",
	},
];

const generateBody = z
	.object({
		model: z.string(),
		think: z.boolean(),
		keep_alive: z.string(),
		options: z.object({ num_ctx: z.number(), num_predict: z.number() }),
	})
	.loose();
const chatBody = z
	.object({
		model: z.string(),
		reasoning_effort: z.string().optional(),
		max_tokens: z.number().optional(),
		response_format: z.object({ type: z.string() }).loose().optional(),
	})
	.loose();

type Mock = {
	version: string;
	hits: string[];
	generate: z.infer<typeof generateBody>[];
	chat: z.infer<typeof chatBody>[];
};

const mock: Mock = { version: "0.34.0", hits: [], generate: [], chat: [] };

const server = Bun.serve({
	port: 0,
	hostname: "127.0.0.1",
	fetch: async (request) => {
		const { pathname } = new URL(request.url);
		mock.hits.push(`${request.method} ${pathname}`);
		if (pathname === "/api/version")
			return Response.json({ version: mock.version });
		if (pathname === "/api/tags")
			return Response.json({ models: [{ name: modelId }] });
		if (pathname === "/api/generate") {
			mock.generate.push(generateBody.parse(await request.json()));
			return Response.json({ model: modelId, done: true });
		}
		if (pathname === "/api/ps")
			return Response.json({
				models: [{ name: modelId, context_length: 4096 }],
			});
		if (pathname === "/v1/chat/completions") {
			mock.chat.push(chatBody.parse(await request.json()));
			return Response.json({
				id: "mock",
				created: 1,
				model: modelId,
				choices: [
					{
						index: 0,
						message: {
							role: "assistant",
							content: JSON.stringify({ operations }),
						},
						finish_reason: "stop",
					},
				],
			});
		}
		return new Response("unexpected", { status: 404 });
	},
});

const saved = {
	mode: process.env.CRM_INFERENCE_MODE,
	config: process.env.CRM_LOCAL_INFERENCE_JSON,
};

beforeAll(() => {
	process.env.CRM_INFERENCE_MODE = "LOCAL";
	process.env.CRM_LOCAL_INFERENCE_JSON = JSON.stringify({
		baseURL: `http://127.0.0.1:${server.port}/v1`,
		modelId,
		contextWindowTokens: 4096,
		maxOutputTokens: 1024,
	});
});

afterEach(() => {
	mock.version = "0.34.0";
	mock.hits = [];
	mock.generate = [];
	mock.chat = [];
});

afterAll(() => {
	server.stop(true);
	if (saved.mode === undefined) delete process.env.CRM_INFERENCE_MODE;
	else process.env.CRM_INFERENCE_MODE = saved.mode;
	if (saved.config === undefined) delete process.env.CRM_LOCAL_INFERENCE_JSON;
	else process.env.CRM_LOCAL_INFERENCE_JSON = saved.config;
});

const request = {
	id: "00000000-0000-4000-8000-000000000001",
	source,
	contactId,
	profileId: "qwen-local-experimental",
	profileRevision: "sales-qwen-v1",
};

describe("local extraction against a mocked Ollama (no real model)", () => {
	it("verifies, warms, extracts and hands the proposal to the API callback", async () => {
		const saves: unknown[] = [];
		await processSalesRequest(
			request,
			async (proposal) => {
				saves.push(proposal);
			},
			"mock/qwen3.5:4b",
		);

		expect(saves).toEqual([
			{ requestId: request.id, operations, producedBy: "mock/qwen3.5:4b" },
		]);
		expect(mock.hits).toEqual([
			"GET /api/version",
			"GET /api/tags",
			"POST /api/generate",
			"GET /api/version",
			"GET /api/ps",
			"POST /v1/chat/completions",
		]);
		expect(mock.generate[0]).toMatchObject({
			model: modelId,
			think: false,
			keep_alive: "2m",
			options: { num_ctx: 4096, num_predict: 1 },
		});
		expect(mock.chat[0]).toMatchObject({
			model: modelId,
			reasoning_effort: "none",
			max_tokens: 768,
			response_format: { type: "json_schema" },
		});
	});

	it("refuses an unverified Ollama version before any model request", async () => {
		mock.version = "0.35.0";
		await expect(
			processSalesRequest(request, async () => undefined, "mock"),
		).rejects.toThrow("Ollama 0.35.0 is not a verified version");
		expect(mock.hits).toEqual(["GET /api/version"]);
	});
});
