import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { db } from "@crm/db";
import { seal } from "../agent/lib/codex/seal";
import { codexBindingFor, codexSelection } from "../agent/lib/codex/selection";
import {
	claimSalesRequests,
	processClaimedSalesRequest,
} from "../agent/lib/sales-worker";

const userId = "sales-worker-user";
const contactId = "sales-worker-contact";
const source = "Head of Procurement. Send the revised quote. Prefers email.";
const savedKey = process.env.CRM_SECRETS_KEY;

type Claims = {
	exp: number;
	"https://api.openai.com/auth": { chatgpt_account_id: string };
};

function jwt(claims: Claims): string {
	const part = (value: Claims | { alg: string }) =>
		Buffer.from(JSON.stringify(value)).toString("base64url");
	return `${part({ alg: "none" })}.${part(claims)}.sig`;
}

const access = jwt({
	exp: Math.floor(Date.now() / 1000) + 3600,
	"https://api.openai.com/auth": { chatgpt_account_id: "acct-1" },
});

async function connect(modelId: string | null) {
	await db.codexConnection.create({
		data: {
			userId,
			kind: "CHATGPT",
			label: "rep@example.com",
			sealed: seal(
				JSON.stringify({
					kind: "CHATGPT",
					idToken: null,
					accessToken: access,
					refreshToken: "refresh-1",
				}),
				`codex-connection:${userId}`,
			),
			modelId,
			modelContextWindowTokens: modelId ? 200_000 : null,
		},
	});
}

async function request(profileId: string, profileRevision: string) {
	const contact = await db.contact.findUniqueOrThrow({
		where: { id: contactId },
	});
	return db.salesRequest.create({
		data: {
			id: randomUUID(),
			source,
			contactId,
			contactSnapshot: {},
			expectedUpdatedAt: contact.updatedAt,
			profileId,
			profileRevision,
			requestedById: userId,
		},
	});
}

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
];

function sse(text: string): Response {
	const events = [
		{
			type: "response.created",
			response: { id: "r", created_at: 1, model: "m" },
		},
		{
			type: "response.output_item.added",
			output_index: 0,
			item: { type: "message", id: "msg" },
		},
		{
			type: "response.output_text.delta",
			item_id: "msg",
			output_index: 0,
			content_index: 0,
			delta: text,
		},
		{
			type: "response.output_item.done",
			output_index: 0,
			item: {
				type: "message",
				id: "msg",
				role: "assistant",
				status: "completed",
				content: [{ type: "output_text", text, annotations: [] }],
			},
		},
		{
			type: "response.completed",
			response: {
				id: "r",
				created_at: 1,
				model: "m",
				status: "completed",
				usage: {
					input_tokens: 1,
					input_tokens_details: { cached_tokens: 0 },
					output_tokens: 1,
					output_tokens_details: { reasoning_tokens: 0 },
				},
			},
		},
	];
	return new Response(
		events
			.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
			.join(""),
		{ headers: { "content-type": "text/event-stream" } },
	);
}

async function clear() {
	await db.salesProposal.deleteMany({ where: { request: { contactId } } });
	await db.salesRequest.deleteMany({ where: { contactId } });
	await db.codexConnection.deleteMany({ where: { userId } });
}

beforeAll(async () => {
	process.env.CRM_SECRETS_KEY = "cd".repeat(32);
	await db.user.upsert({
		where: { id: userId },
		create: { id: userId, name: userId, email: `${userId}@example.com` },
		update: {},
	});
	await db.contact.upsert({
		where: { id: contactId },
		create: { id: contactId, firstName: "Worker", title: "Buyer" },
		update: {},
	});
});

afterEach(clear);

afterAll(async () => {
	await clear();
	await db.contact.deleteMany({ where: { id: contactId } });
	await db.user.deleteMany({ where: { id: userId } });
	if (savedKey === undefined) delete process.env.CRM_SECRETS_KEY;
	else process.env.CRM_SECRETS_KEY = savedKey;
});

describe("the in-CRM sales worker", () => {
	it("claims only CRM-processed profiles, once per lease", async () => {
		const external = await request("qwen-local-experimental", "sales-qwen-v1");
		const codex = await request("crm-codex", "sales-codex-v1");
		const first = await claimSalesRequests(10);
		const ids = first.map((row) => row.id);
		expect(ids).toContain(codex.id);
		expect(ids).not.toContain(external.id);
		expect((await claimSalesRequests(10)).map((row) => row.id)).not.toContain(
			codex.id,
		);
	});

	it("keeps request content immutable while the lease column changes", async () => {
		const row = await request("crm-codex", "sales-codex-v1");
		await db.salesRequest.update({
			where: { id: row.id },
			data: { leasedUntil: new Date() },
		});
		await expect(
			Promise.resolve(
				db.salesRequest.update({
					where: { id: row.id },
					data: { source: "rewritten" },
				}),
			),
		).rejects.toThrow("Sales request content is immutable");
	});

	it("proposes through the requester's Codex connection and leaves approval to a human", async () => {
		await connect("gpt-test");
		const row = await request("crm-codex", "sales-codex-v1");
		const [claimed] = await claimSalesRequests(10);
		if (!claimed) throw new Error("nothing claimed");
		const sent: string[] = [];
		const outcome = await processClaimedSalesRequest(claimed, (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			sent.push(String(input));
			expect(JSON.parse(String(init?.body)).text.format.type).toBe(
				"json_schema",
			);
			return sse(JSON.stringify({ operations }));
		}) as typeof fetch);
		expect(outcome).toBe("proposed");
		expect(sent).toEqual(["https://chatgpt.com/backend-api/codex/responses"]);
		const stored = await db.salesRequest.findUniqueOrThrow({
			where: { id: row.id },
			include: { proposal: true },
		});
		expect(stored.status).toBe("PROPOSED");
		expect(stored.leasedUntil).toBeNull();
		expect(stored.proposal).toMatchObject({
			producedBy: "crm-agent/codex:gpt-test",
			proposedById: null,
			approvedAt: null,
			operations,
		});
	});

	it("fails the request with a reason when the requester has no Codex model", async () => {
		await connect(null);
		const row = await request("crm-codex", "sales-codex-v1");
		const [claimed] = await claimSalesRequests(10);
		if (!claimed) throw new Error("nothing claimed");
		expect(await processClaimedSalesRequest(claimed, fetch)).toBe("failed");
		const stored = await db.salesRequest.findUniqueOrThrow({
			where: { id: row.id },
		});
		expect(stored.status).toBe("FAILED");
		expect(stored.error).toContain("SALES_CODEX_UNAVAILABLE");
	});

	it("fails a crm-ollama request when local inference is not configured", async () => {
		const saved = process.env.CRM_LOCAL_INFERENCE_JSON;
		delete process.env.CRM_LOCAL_INFERENCE_JSON;
		try {
			const row = await request("crm-ollama", "sales-qwen-v1");
			const [claimed] = await claimSalesRequests(10);
			if (!claimed) throw new Error("nothing claimed");
			expect(await processClaimedSalesRequest(claimed, fetch)).toBe("failed");
			const stored = await db.salesRequest.findUniqueOrThrow({
				where: { id: row.id },
			});
			expect(stored.error).toContain("SALES_OLLAMA_UNAVAILABLE");
		} finally {
			if (saved !== undefined) process.env.CRM_LOCAL_INFERENCE_JSON = saved;
		}
	});
});

describe("chat routing to Codex", () => {
	it("binds only an active connection with a chosen model", async () => {
		await connect(null);
		expect(await codexBindingFor(userId)).toBeNull();
		await db.codexConnection.update({
			where: { userId },
			data: { modelId: "gpt-test", modelContextWindowTokens: 200_000 },
		});
		expect(await codexBindingFor(userId)).toEqual({
			userId,
			modelId: "gpt-test",
			kind: "CHATGPT",
			contextWindowTokens: 200_000,
		});
		await db.codexConnection.update({
			where: { userId },
			data: { status: "NEEDS_RECONNECT" },
		});
		expect(await codexBindingFor(userId)).toBeNull();
	});

	it("refuses a caller who is not the connection's owner", () => {
		const binding = {
			userId,
			modelId: "gpt-test",
			kind: "CHATGPT" as const,
			contextWindowTokens: 200_000,
		};
		const refused = { model: "refused" as never, modelContextWindowTokens: 1 };
		expect(codexSelection(binding, "someone-else", () => refused)).toBe(
			refused,
		);
		const own = codexSelection(binding, userId, () => refused);
		expect(own.modelContextWindowTokens).toBe(200_000);
		expect(own.model).not.toBe("refused");
	});
});
