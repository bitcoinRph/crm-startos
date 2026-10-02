import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import { codexStatus as statusSchema } from "@crm/validation/codex";
import { z } from "zod";
import { listCodexModels } from "../agent/lib/codex/catalog";
import {
	CodexUnavailableError,
	connectApiKey,
	disconnectCodex,
	pollDeviceLogin,
	resolveCodexCredential,
	startDeviceLogin,
} from "../agent/lib/codex/connection";
import { codexRequestBody, createCodexModel } from "../agent/lib/codex/model";
import { seal, unseal } from "../agent/lib/codex/seal";

const userId = "codex-test-user";
const otherUserId = "codex-test-other";
const accountId = "acct-123";
const savedKey = process.env.CRM_SECRETS_KEY;

type Claims = {
	exp?: number;
	serial?: number;
	email?: string;
	"https://api.openai.com/auth"?: {
		chatgpt_account_id: string;
		chatgpt_plan_type?: string;
	};
};

function jwt(claims: Claims): string {
	const part = (value: Claims | { alg: string }) =>
		Buffer.from(JSON.stringify(value)).toString("base64url");
	return `${part({ alg: "none" })}.${part(claims)}.sig`;
}

function accessToken(serial: number, expiresInSeconds: number): string {
	return jwt({
		exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
		serial,
		"https://api.openai.com/auth": {
			chatgpt_account_id: accountId,
			chatgpt_plan_type: "plus",
		},
	});
}

const idToken = jwt({ email: "rep@example.com" });

type Call = { url: string; method: string; headers: Headers; body: string };

const bodyText = z.string().catch("");

function mockTransport(handler: (call: Call) => Response | Promise<Response>) {
	const calls: Call[] = [];
	const transport = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const call = {
			url: String(input),
			method: init?.method ?? "GET",
			headers: new Headers(init?.headers),
			body: bodyText.parse(init?.body),
		};
		calls.push(call);
		return handler(call);
	}) as typeof fetch;
	return { calls, transport };
}

async function clear() {
	await db.codexDeviceLogin.deleteMany({
		where: { userId: { in: [userId, otherUserId] } },
	});
	await db.codexConnection.deleteMany({
		where: { userId: { in: [userId, otherUserId] } },
	});
}

beforeAll(async () => {
	process.env.CRM_SECRETS_KEY = "ab".repeat(32);
	for (const id of [userId, otherUserId])
		await db.user.upsert({
			where: { id },
			create: { id, name: id, email: `${id}@example.com` },
			update: {},
		});
});

afterEach(clear);

afterAll(async () => {
	await clear();
	await db.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
	if (savedKey === undefined) delete process.env.CRM_SECRETS_KEY;
	else process.env.CRM_SECRETS_KEY = savedKey;
});

async function connectChatgpt(access: string) {
	const { transport } = mockTransport((call) => {
		if (call.url.endsWith("/api/accounts/deviceauth/usercode"))
			return Response.json({
				device_auth_id: "dev-1",
				user_code: "ABCD-EFGH",
				interval: "5",
			});
		if (call.url.endsWith("/api/accounts/deviceauth/token"))
			return Response.json({
				authorization_code: "code-1",
				code_verifier: "verifier-1",
			});
		if (call.url.endsWith("/oauth/token"))
			return Response.json({
				id_token: idToken,
				access_token: access,
				refresh_token: "refresh-1",
			});
		return new Response("unexpected", { status: 500 });
	});
	await startDeviceLogin(userId, transport);
	return pollDeviceLogin(userId, transport);
}

describe("sealing", () => {
	it("round-trips and binds the value to its context", () => {
		const sealed = seal("secret-value", "codex-connection:a");
		expect(sealed).not.toContain("secret-value");
		expect(unseal(sealed, "codex-connection:a")).toBe("secret-value");
		expect(() => unseal(sealed, "codex-connection:b")).toThrow();
	});

	it("refuses to connect without CRM_SECRETS_KEY", async () => {
		delete process.env.CRM_SECRETS_KEY;
		try {
			await expect(startDeviceLogin(userId, fetch)).rejects.toThrow(
				"CRM_SECRETS_KEY is not set",
			);
		} finally {
			process.env.CRM_SECRETS_KEY = "ab".repeat(32);
		}
	});
});

describe("device code sign-in", () => {
	it("follows the Codex CLI device flow and seals the tokens", async () => {
		const access = accessToken(1, 3600);
		const { calls, transport } = mockTransport((call) => {
			if (call.url.endsWith("/api/accounts/deviceauth/usercode"))
				return Response.json({
					device_auth_id: "dev-1",
					user_code: "ABCD-EFGH",
					interval: "1",
				});
			if (call.url.endsWith("/api/accounts/deviceauth/token"))
				return calls.filter((c) => c.url === call.url).length === 1
					? new Response("pending", { status: 403 })
					: Response.json({
							authorization_code: "code-1",
							code_verifier: "verifier-1",
						});
			if (call.url.endsWith("/oauth/token"))
				return Response.json({
					id_token: idToken,
					access_token: access,
					refresh_token: "refresh-1",
				});
			return new Response("unexpected", { status: 500 });
		});

		const start = await startDeviceLogin(userId, transport);
		expect(start).toMatchObject({
			verificationUrl: "https://auth.openai.com/codex/device",
			userCode: "ABCD-EFGH",
			intervalSeconds: 3,
		});
		expect(JSON.parse(calls[0]?.body ?? "")).toEqual({
			client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
		});

		expect(await pollDeviceLogin(userId, transport)).toEqual({
			state: "pending",
		});
		const connected = await pollDeviceLogin(userId, transport);
		expect(connected.state).toBe("connected");

		const exchange = calls.find((c) => c.url.endsWith("/oauth/token"));
		expect(exchange?.headers.get("content-type")).toBe(
			"application/x-www-form-urlencoded",
		);
		expect(Object.fromEntries(new URLSearchParams(exchange?.body))).toEqual({
			grant_type: "authorization_code",
			code: "code-1",
			redirect_uri: "https://auth.openai.com/deviceauth/callback",
			client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
			code_verifier: "verifier-1",
		});

		const row = await db.codexConnection.findUniqueOrThrow({
			where: { userId },
		});
		expect(row.sealed).not.toContain(access);
		expect(row.sealed).not.toContain("refresh-1");
		expect(row).toMatchObject({
			kind: "CHATGPT",
			status: "ACTIVE",
			label: "rep@example.com",
			planType: "plus",
		});
		expect(await db.codexDeviceLogin.count({ where: { userId } })).toBe(0);

		const status = statusSchema.parse(
			connected.state === "connected" ? connected.status : null,
		);
		expect(JSON.stringify(status)).not.toContain(access);
		expect(JSON.stringify(status)).not.toContain("refresh-1");
	});

	it("reports an expired sign-in and forgets it", async () => {
		const { transport } = mockTransport(() =>
			Response.json({ device_auth_id: "dev-1", user_code: "X", interval: 5 }),
		);
		await startDeviceLogin(userId, transport);
		await db.codexDeviceLogin.update({
			where: { userId },
			data: { expiresAt: new Date(Date.now() - 1000) },
		});
		expect(await pollDeviceLogin(userId, transport)).toEqual({
			state: "expired",
		});
		expect(await db.codexDeviceLogin.count({ where: { userId } })).toBe(0);
	});
});

describe("token refresh", () => {
	it("refreshes an expiring token once under concurrent use", async () => {
		await connectChatgpt(accessToken(1, 30));
		const fresh = accessToken(2, 3600);
		const { calls, transport } = mockTransport(async () => {
			await new Promise((resolve) => setTimeout(resolve, 50));
			return Response.json({ access_token: fresh, refresh_token: "refresh-2" });
		});

		const results = await Promise.all([
			resolveCodexCredential(userId, transport),
			resolveCodexCredential(userId, transport),
			resolveCodexCredential(userId, transport),
		]);

		expect(calls).toHaveLength(1);
		expect(JSON.parse(calls[0]?.body ?? "")).toEqual({
			client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
			grant_type: "refresh_token",
			refresh_token: "refresh-1",
		});
		for (const credential of results)
			expect(credential).toEqual({
				kind: "CHATGPT",
				accessToken: fresh,
				accountId,
			});
	});

	it("marks the connection for reconnect when OpenAI ends the session", async () => {
		await connectChatgpt(accessToken(1, 30));
		const { transport } = mockTransport(() =>
			Response.json(
				{ error: { code: "refresh_token_reused" } },
				{ status: 401 },
			),
		);
		await expect(resolveCodexCredential(userId, transport)).rejects.toThrow(
			CodexUnavailableError,
		);
		const row = await db.codexConnection.findUniqueOrThrow({
			where: { userId },
		});
		expect(row.status).toBe("NEEDS_RECONNECT");
	});

	it("keeps another user's connection out of reach", async () => {
		await connectChatgpt(accessToken(1, 3600));
		await expect(resolveCodexCredential(otherUserId, fetch)).rejects.toThrow(
			"Codex is not connected",
		);
	});
});

function sse(events: readonly { type: string }[]): Response {
	const body = events
		.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
		.join("");
	return new Response(body, {
		headers: { "content-type": "text/event-stream" },
	});
}

const completion = [
	{
		type: "response.created",
		response: { id: "resp_1", created_at: 1, model: "gpt-test" },
	},
	{
		type: "response.output_item.added",
		output_index: 0,
		item: { type: "message", id: "msg_1" },
	},
	{
		type: "response.output_text.delta",
		item_id: "msg_1",
		output_index: 0,
		content_index: 0,
		delta: "Hello",
	},
	{
		type: "response.output_item.done",
		output_index: 0,
		item: {
			type: "message",
			id: "msg_1",
			role: "assistant",
			status: "completed",
			content: [{ type: "output_text", text: "Hello", annotations: [] }],
		},
	},
	{
		type: "response.completed",
		response: {
			id: "resp_1",
			created_at: 1,
			model: "gpt-test",
			status: "completed",
			usage: {
				input_tokens: 5,
				input_tokens_details: { cached_tokens: 0 },
				output_tokens: 1,
				output_tokens_details: { reasoning_tokens: 0 },
			},
		},
	},
];

describe("Codex model", () => {
	it("shapes the request the way the Codex backend expects", () => {
		const body = JSON.parse(
			codexRequestBody(
				JSON.stringify({
					model: "gpt-test",
					input: [
						{ role: "system", content: "Be brief." },
						{ role: "user", content: [{ type: "input_text", text: "Hi" }] },
					],
					max_output_tokens: 100,
					temperature: 0,
					store: true,
				}),
			),
		);
		expect(body).toEqual({
			model: "gpt-test",
			instructions: "Be brief.",
			input: [{ role: "user", content: [{ type: "input_text", text: "Hi" }] }],
			store: false,
			stream: true,
		});
	});

	it("calls the Codex backend with account headers and retries once after a 401", async () => {
		const first = accessToken(1, 3600);
		await connectChatgpt(first);
		const fresh = accessToken(2, 3600);
		let responses = 0;
		const { calls, transport } = mockTransport((call) => {
			if (call.url.endsWith("/oauth/token"))
				return Response.json({ access_token: fresh, refresh_token: "r-2" });
			responses += 1;
			return responses === 1
				? new Response("expired", { status: 401 })
				: sse(completion);
		});

		const model = createCodexModel(userId, "gpt-test", "CHATGPT", transport);
		const result = await model.doGenerate({
			prompt: [
				{ role: "system", content: "Be brief." },
				{ role: "user", content: [{ type: "text", text: "Hi" }] },
			],
			maxOutputTokens: 50,
		});

		expect(result.content).toEqual([
			{ type: "text", text: "Hello", providerMetadata: expect.anything() },
		]);
		const sends = calls.filter((call) =>
			call.url.endsWith("/backend-api/codex/responses"),
		);
		expect(sends).toHaveLength(2);
		expect(sends[0]?.headers.get("authorization")).toBe(`Bearer ${first}`);
		expect(sends[1]?.headers.get("authorization")).toBe(`Bearer ${fresh}`);
		for (const send of sends) {
			expect(send.headers.get("chatgpt-account-id")).toBe(accountId);
			expect(send.headers.get("originator")).toBe("crm-startos");
			const body = JSON.parse(send.body);
			expect(body).toMatchObject({
				model: "gpt-test",
				instructions: "Be brief.",
				store: false,
				stream: true,
			});
			expect(body.max_output_tokens).toBeUndefined();
		}
	});

	it("refuses any other destination", async () => {
		await connectChatgpt(accessToken(1, 3600));
		const { transport } = mockTransport(() => sse(completion));
		const model = createCodexModel(userId, "gpt-test", "API_KEY", transport);
		await expect(
			model.doGenerate({
				prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
			}),
		).rejects.toThrow("The Codex connection changed");
	});
});

describe("catalog and API key fallback", () => {
	it("lists only listed Codex models, by priority", async () => {
		await connectChatgpt(accessToken(1, 3600));
		const { calls, transport } = mockTransport(() =>
			Response.json({
				models: [
					{
						slug: "b",
						priority: 2,
						visibility: "list",
						context_window: 200000,
					},
					{ slug: "hidden", priority: 0, visibility: "hide" },
					{ slug: "a", display_name: "A", priority: 1, visibility: "list" },
				],
			}),
		);
		expect(await listCodexModels(userId, transport)).toEqual({
			available: true,
			reason: null,
			models: [
				{ id: "a", name: "A", contextWindowTokens: null },
				{ id: "b", name: "b", contextWindowTokens: 200000 },
			],
		});
		expect(calls[0]?.url).toBe(
			"https://chatgpt.com/backend-api/codex/models?client_version=99.0.0",
		);
		expect(calls[0]?.headers.get("chatgpt-account-id")).toBe(accountId);
	});

	it("stores a checked API key sealed and shows only its last four", async () => {
		const key = "sk-test-0123456789abcdefWXYZ";
		const { transport } = mockTransport(() => Response.json({ data: [] }));
		const status = await connectApiKey(userId, key, transport);
		expect(status.kind).toBe("API_KEY");
		expect(status.label).toBe("OpenAI API key ••••WXYZ");
		expect(JSON.stringify(status)).not.toContain(key);
		const row = await db.codexConnection.findUniqueOrThrow({
			where: { userId },
		});
		expect(row.sealed).not.toContain(key);
	});

	it("refuses an API key OpenAI does not accept", async () => {
		const { transport } = mockTransport(
			() => new Response("no", { status: 401 }),
		);
		await expect(
			connectApiKey(userId, "sk-test-0123456789abcdefWXYZ", transport),
		).rejects.toThrow("did not accept");
		expect(await db.codexConnection.count({ where: { userId } })).toBe(0);
	});

	it("disconnect deletes the row and revokes the refresh token", async () => {
		await connectChatgpt(accessToken(1, 3600));
		const { calls, transport } = mockTransport(() => new Response(null));
		const status = await disconnectCodex(userId, transport);
		expect(status.connected).toBe(false);
		expect(await db.codexConnection.count({ where: { userId } })).toBe(0);
		expect(calls[0]?.url).toBe("https://auth.openai.com/oauth/revoke");
		expect(JSON.parse(calls[0]?.body ?? "")).toEqual({
			token: "refresh-1",
			token_type_hint: "refresh_token",
			client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
		});
	});
});
