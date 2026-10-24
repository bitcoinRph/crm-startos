import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	spyOn,
} from "bun:test";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { setImmediate } from "node:timers/promises";
import { API_KEY_RATE_LIMIT, auth } from "@crm/auth";
import { db } from "@crm/db";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolRequest } from "@modelcontextprotocol/sdk/types.js";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { getProcedureAtPath } from "@trpc/server/unstable-core-do-not-import";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { AppRouterHost } from "nestjs-trpc";
import { z } from "zod";
import { activityEntryOutput } from "../src/activities/activities.contracts";
import { ActivitiesService } from "../src/activities/activities.service";
import * as localDay from "../src/activities/local-day";
import { ApiKeyAuditService } from "../src/api-keys/api-key-audit.service";
import {
	type ApiKeyProfile,
	KEY_PERMISSIONS,
} from "../src/api-keys/api-key-profiles";
import { MCP_TOOLS } from "../src/mcp/mcp-tools";
import { salesPendingOutput } from "../src/sales/sales.contracts";
import { SearchService } from "../src/search/search.service";

const prefix = `mcp-${randomUUID()}`;
const companyId = `${prefix}-company`;
const contactId = `${prefix}-contact`;
const dealId = `${prefix}-deal`;
const wireResult = z.object({
	isError: z.boolean().optional(),
	content: z.array(z.object({ type: z.literal("text"), text: z.string() })),
});

function testAuth() {
	return betterAuth({
		...auth.options,
		baseURL: "http://localhost:3001",
		secret: "mcp-regression-fixture-secret-at-least-32-characters",
		database: memoryAdapter({
			user: [],
			session: [],
			account: [],
			verification: [],
			apikey: [],
			member: [],
			organization: [],
		}),
		databaseHooks: {},
		socialProviders: {},
		emailAndPassword: { enabled: true, disableSignUp: false },
		rateLimit: { enabled: false },
	});
}

let app: NestExpressApplication;
let endpoint: URL;
let fixture: ReturnType<typeof testAuth>;
let userId: string;
let cookie: string;
let reader: Client;
let readerKey: Awaited<
	ReturnType<ReturnType<typeof testAuth>["api"]["createApiKey"]>
>;
let sessionSpy: ReturnType<typeof spyOn<typeof auth.api, "getSession">>;
let verifySpy: ReturnType<typeof spyOn<typeof auth.api, "verifyApiKey">>;
let auditSpy: ReturnType<typeof spyOn<ApiKeyAuditService, "record">>;
const clients: Client[] = [];
const extraUserIds: string[] = [];

async function connect(headers: NonNullable<RequestInit["headers"]>) {
	const client = new Client({ name: "crm-contract-fixture", version: "1" });
	clients.push(client);
	await client.connect(
		new StreamableHTTPClientTransport(endpoint, { requestInit: { headers } }),
	);
	return client;
}

async function createKey(profile?: ApiKeyProfile) {
	return fixture.api.createApiKey({
		body: {
			userId,
			name: "Synthetic MCP contract",
			permissions: profile ? KEY_PERMISSIONS[profile] : undefined,
		},
	});
}

async function call(client: Client, params: CallToolRequest["params"]) {
	return wireResult.parse(await client.callTool(params));
}

async function read<T>(
	name: string,
	args: CallToolRequest["params"]["arguments"],
	schema: z.ZodType<T>,
) {
	const result = await call(reader, { name, arguments: args });
	expect(result.isError).not.toBe(true);
	return schema.parse(JSON.parse(z.string().parse(result.content[0]?.text)));
}

beforeAll(async () => {
	const { createApp } = await import("../src/create-app");
	app = await createApp();
	await app.listen(0, "127.0.0.1");
	endpoint = new URL("/api/mcp", await app.getUrl());
});

beforeEach(async () => {
	fixture = testAuth();
	const response = await fixture.handler(
		new Request("http://localhost:3001/api/auth/sign-up/email", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				name: "MCP fixture",
				email: `${prefix}@example.com`,
				password: "synthetic-password-long-enough",
			}),
		}),
	);
	expect(response.status).toBe(200);
	userId = z
		.object({ user: z.object({ id: z.string() }) })
		.parse(await response.json()).user.id;
	cookie = response.headers
		.getSetCookie()
		.map((value) => value.split(";")[0])
		.join("; ");
	sessionSpy = spyOn(auth.api, "getSession").mockImplementation(
		fixture.api.getSession,
	);
	verifySpy = spyOn(auth.api, "verifyApiKey").mockImplementation(
		fixture.api.verifyApiKey,
	);
	auditSpy = spyOn(ApiKeyAuditService.prototype, "record").mockImplementation(
		() => undefined,
	);
	await db.user.create({
		data: { id: userId, name: "MCP fixture", email: `${prefix}@example.com` },
	});
	await db.company.create({
		data: { id: companyId, name: `${prefix} active`, domain: `${prefix}.test` },
	});
	await db.contact.create({
		data: {
			id: contactId,
			firstName: `${prefix} active`,
			email: `active@${prefix}.test`,
			companyId,
		},
	});
	await db.deal.create({
		data: { id: dealId, name: `${prefix} active`, companyId, ownerId: userId },
	});
	readerKey = await createKey("agent_read");
	reader = await connect({ "x-api-key": readerKey.key });
});

afterEach(async () => {
	for (const client of clients.splice(0)) await client.close();
	sessionSpy?.mockRestore();
	verifySpy?.mockRestore();
	auditSpy?.mockRestore();
	await db.activity.deleteMany({ where: { id: { startsWith: prefix } } });
	await db.deal.deleteMany({ where: { id: { startsWith: prefix } } });
	await db.contact.deleteMany({ where: { id: { startsWith: prefix } } });
	await db.contact.deleteMany({ where: { email: `lead@${prefix}.test` } });
	await db.company.deleteMany({ where: { id: { startsWith: prefix } } });
	if (userId)
		await db.user.deleteMany({
			where: { id: { in: [userId, ...extraUserIds.splice(0)] } },
		});
});

afterAll(async () => {
	await app?.close();
});

describe("MCP contract", () => {
	it("refuses a rate-limited key with HTTP 429 and keeps other keys working", async () => {
		const limited = await createKey("agent_read");
		for (let used = 0; used < API_KEY_RATE_LIMIT.maxRequests; used++) {
			const verified = await fixture.api.verifyApiKey({
				body: { key: limited.key },
			});
			expect(verified.valid).toBe(true);
		}
		const response = await fetch(endpoint, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-api-key": limited.key,
			},
			body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
		});
		expect(response.status).toBe(429);
		expect(
			z.object({ error: z.string() }).parse(await response.json()).error,
		).toContain("rate limit");
		const trpc = await fetch(new URL("/api/trpc/contacts.list", endpoint), {
			headers: { "x-api-key": limited.key },
		});
		expect(trpc.status).toBe(429);
		const rest = await fetch(
			new URL("/rest/search/resolve-customer?email=a@b.test", endpoint),
			{ headers: { authorization: `Bearer ${limited.key}` } },
		);
		expect(rest.status).toBe(429);
		const tools = await reader.listTools();
		expect(tools.tools.length).toBeGreaterThan(0);
	});

	it("drains rejected POST bytes without parsing JSON-RPC", async () => {
		let drained: boolean | undefined;
		const observe = (request: IncomingMessage, response: ServerResponse) => {
			if (request.headers["x-fixture-request"] !== prefix) return;
			response.once("finish", () => {
				drained = request.readableEnded;
			});
		};
		const server = app.getHttpServer();
		server.prependListener("request", observe);
		try {
			const response = await fetch(endpoint, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-fixture-request": prefix,
				},
				body: JSON.stringify({ padding: prefix }).slice(0, -1),
			});
			expect(response.status).toBe(401);
			expect(
				z.object({ error: z.string() }).parse(await response.json()).error,
			).toContain("API key");
			expect(drained).toBe(true);
		} finally {
			server.off("request", observe);
		}
	});

	it("rejects unauthenticated GET without starting a stream", async () => {
		const response = await fetch(endpoint);
		expect(response.status).toBe(405);
		expect(response.headers.get("allow")).toBe("POST");
		expect(await response.json()).toEqual({
			jsonrpc: "2.0",
			error: { code: -32000, message: "Method not allowed." },
			id: null,
		});
	});

	it("rejects GET and DELETE independently of key validity without checking auth", async () => {
		const key = await createKey("agent_read");
		await fixture.api.deleteApiKey({
			headers: new Headers({ cookie }),
			body: { keyId: key.id },
		});
		const sessionCalls = sessionSpy.mock.calls.length;
		const verifyCalls = verifySpy.mock.calls.length;
		const credentials: NonNullable<RequestInit["headers"]>[] = [
			{},
			{ "x-api-key": readerKey.key },
			{ authorization: `Bearer ${readerKey.key}` },
			{ "x-api-key": key.key },
			{ "x-api-key": "crm_invalid_fixture_key" },
		];
		for (const headers of credentials) {
			for (const method of ["GET", "DELETE"]) {
				const response = await fetch(endpoint, { method, headers });
				expect(response.status).toBe(405);
				expect(response.headers.get("allow")).toBe("POST");
				expect(response.headers.get("content-type")).toContain(
					"application/json",
				);
				expect(await response.json()).toEqual({
					jsonrpc: "2.0",
					error: { code: -32000, message: "Method not allowed." },
					id: null,
				});
			}
		}
		expect(sessionSpy.mock.calls.length).toBe(sessionCalls);
		expect(verifySpy.mock.calls.length).toBe(verifyCalls);
	});

	it("keeps authenticated POST tool discovery JSON-only and stateless", async () => {
		const response = await fetch(endpoint, {
			method: "POST",
			headers: {
				"x-api-key": readerKey.key,
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
			},
			body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
		});
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("application/json");
		expect(response.headers.get("mcp-session-id")).toBeNull();
		const result = z
			.object({
				result: z.object({ tools: z.array(z.object({ name: z.string() })) }),
			})
			.parse(await response.json());
		expect(result.result.tools.some((tool) => tool.name === "whoami")).toBe(
			true,
		);
	});

	it("rejects a background GET released after revocation without a client error", async () => {
		let releaseGet!: () => void;
		const gate = new Promise<void>((resolve) => {
			releaseGet = resolve;
		});
		let recordGet!: (status: number) => void;
		const recorded = new Promise<number>((resolve) => {
			recordGet = resolve;
		});
		const key = await createKey("agent_read");
		const client = new Client({ name: "crm-revocation-fixture", version: "1" });
		const errors: Error[] = [];
		client.onerror = (error) => errors.push(error);
		clients.push(client);
		try {
			await client.connect(
				new StreamableHTTPClientTransport(endpoint, {
					requestInit: { headers: { "x-api-key": key.key } },
					fetch: async (input, init) => {
						if (init?.method === "GET") await gate;
						const response = await fetch(input, init);
						if (init?.method === "GET") {
							const body = response.body;
							if (body) {
								const cancel = body.cancel.bind(body);
								body.cancel = async (reason) => {
									await cancel(reason);
									recordGet(response.status);
								};
							} else {
								recordGet(response.status);
							}
						}
						return response;
					},
				}),
			);
			await fixture.api.deleteApiKey({
				headers: new Headers({ cookie }),
				body: { keyId: key.id },
			});
			releaseGet();
			expect(await recorded).toBe(405);
			await setImmediate();
			await client.close();
			const response = await fetch(endpoint, {
				method: "POST",
				headers: { "x-api-key": key.key, "content-type": "application/json" },
				body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
			});
			expect(response.status).toBe(401);
			expect(
				z.object({ error: z.string() }).parse(await response.json()).error,
			).toContain("API key");
			expect(errors).toEqual([]);
		} finally {
			releaseGet();
			await client.close();
		}
	});

	it("closes an aborted unauthenticated POST during body draining", async () => {
		const controller = new AbortController();
		const observe = (request: IncomingMessage) => {
			if (request.headers["x-fixture-request"] !== prefix) return;
			request.once("resume", () => controller.abort());
		};
		const server = app.getHttpServer();
		server.prependListener("request", observe);
		try {
			const response = fetch(endpoint, {
				method: "POST",
				headers: { "x-fixture-request": prefix },
				signal: controller.signal,
				body: new ReadableStream<Uint8Array>({
					start(stream) {
						stream.enqueue(new TextEncoder().encode("{"));
					},
				}),
			}).then(
				() => false,
				() => true,
			);
			expect(await response).toBe(true);
		} finally {
			controller.abort();
			server.off("request", observe);
		}
	});

	it("M1 excludes archived contacts, companies and deals without a parent cascade", async () => {
		const archivedCompany = `${prefix}-archived-company`;
		const archivedContact = `${prefix}-archived-contact`;
		const archivedDeal = `${prefix}-archived-deal`;
		await db.company.create({
			data: {
				id: archivedCompany,
				name: `${prefix} archived`,
				archivedAt: new Date(),
			},
		});
		await db.contact.create({
			data: {
				id: archivedContact,
				firstName: `${prefix} archived`,
				archivedAt: new Date(),
			},
		});
		await db.deal.create({
			data: {
				id: archivedDeal,
				name: `${prefix} archived`,
				companyId,
				ownerId: userId,
				archivedAt: new Date(),
			},
		});
		await db.contact.create({
			data: {
				id: `${prefix}-active-child`,
				firstName: `${prefix} child`,
				companyId: archivedCompany,
			},
		});
		const result = await read(
			"search_crm",
			{ q: prefix },
			z.object({ hits: z.array(z.object({ id: z.string() })) }),
		);
		expect(result.hits.map((hit) => hit.id).sort()).toEqual(
			[companyId, contactId, dealId, `${prefix}-active-child`].sort(),
		);
	});

	it("M2 marks readOnlyHint exactly for queries", async () => {
		const client = await connect({ cookie });
		const { tools } = await client.listTools();
		expect(tools.map((tool) => tool.name).sort()).toEqual(
			MCP_TOOLS.map((tool) => tool.name).sort(),
		);
		for (const spec of MCP_TOOLS) {
			const procedure = await getProcedureAtPath(
				app.get(AppRouterHost).appRouter,
				spec.procedure,
			);
			expect(
				tools.find((tool) => tool.name === spec.name)?.annotations
					?.readOnlyHint,
			).toBe(procedure?._def.type === "query");
		}
	});

	it("M3 denies a reader mutation without changing the row", async () => {
		const before = await db.contact.findUniqueOrThrow({
			where: { id: contactId },
		});
		const result = await call(reader, {
			name: "update_contact",
			arguments: { id: contactId, data: { firstName: "Forbidden change" } },
		});
		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toStartWith("FORBIDDEN:");
		expect(
			await db.contact.findUniqueOrThrow({ where: { id: contactId } }),
		).toEqual(before);
	});

	it("records an MCP call and a refused MCP call against the key", async () => {
		await call(reader, { name: "get_company", arguments: { id: companyId } });
		await call(reader, {
			name: "update_contact",
			arguments: { id: contactId, data: { firstName: "Forbidden change" } },
		});
		expect(auditSpy.mock.calls.map(([entry]) => entry)).toEqual([
			{
				keyId: readerKey.id,
				procedure: "companies.byId",
				type: "query",
				outcome: "allowed",
			},
			{
				keyId: readerKey.id,
				procedure: "contacts.update",
				type: "mutation",
				outcome: "denied",
			},
		]);
	});

	it("M4 never exposes key management or Codex procedures", () => {
		expect(
			MCP_TOOLS.some((tool) => /^(apiKeys|codex)\./.test(tool.procedure)),
		).toBe(false);
	});

	it("M5 returns HTTP 401 JSON before parsing an unauthenticated body", async () => {
		const response = await fetch(endpoint, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{",
		});
		expect(response.status).toBe(401);
		expect(response.headers.get("content-type")).toContain("application/json");
		expect(
			z.object({ error: z.string() }).parse(await response.json()).error,
		).toContain("API key");
	});

	it("M6 rejects the next call after key deletion", async () => {
		await fixture.api.deleteApiKey({
			headers: new Headers({ cookie }),
			body: { keyId: readerKey.id },
		});
		const response = await fetch(endpoint, {
			method: "POST",
			headers: {
				"x-api-key": readerKey.key,
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: { name: "whoami", arguments: {} },
			}),
		});
		expect(response.status).toBe(401);
	});

	it("E1 exports active records as CSV for a read-only key and leaves the rows alone", async () => {
		await db.company.create({
			data: {
				id: `${prefix}-archived-company`,
				name: `${prefix} archived`,
				domain: `archived-${prefix}.test`,
				archivedAt: new Date(),
			},
		});
		const exported = z.object({
			entity: z.string(),
			filename: z.string(),
			csv: z.string(),
			rows: z.number(),
			truncated: z.boolean(),
		});
		const before = await ownedState();
		const companies = await read(
			"export_csv",
			{ entity: "companies" },
			exported,
		);
		expect(companies.filename).toBe("companies.csv");
		expect(companies.truncated).toBe(false);
		expect(companies.csv).toContain(companyId);
		expect(companies.csv).toContain(`${prefix}.test`);
		expect(companies.csv).not.toContain(`archived-${prefix}.test`);
		const contacts = await read("export_csv", { entity: "contacts" }, exported);
		expect(contacts.csv).toContain(`active@${prefix}.test`);
		const deals = await read("export_csv", { entity: "deals" }, exported);
		expect(deals.csv).toContain(dealId);
		expect(deals.csv).toContain(`${prefix} active`);
		expect(await ownedState()).toEqual(before);
		const invalid = await call(reader, {
			name: "export_csv",
			arguments: { entity: "users" },
		});
		expect(invalid.isError).toBe(true);
	});
});

const existingProfileTools = {
	crm_integration: [
		"sales_get_request",
		"sales_pending_requests",
		"search_crm",
		"whoami",
		"list_users",
		"get_workspace",
		"dashboard_summary",
		"list_contacts",
		"get_contact",
		"create_contact",
		"update_contact",
		"enrich_contact",
		"list_companies",
		"get_company",
		"create_company",
		"update_company",
		"enrich_company",
		"list_deals",
		"get_deal",
		"create_deal",
		"update_deal",
		"set_deal_stage",
		"attach_contact_to_deal",
		"timeline",
		"my_tasks",
		"log_activity",
		"complete_task",
		"list_fields",
	],
	agent_propose: [
		"sales_create_request",
		"sales_get_request",
		"sales_pending_requests",
		"sales_store_proposal",
		"sales_fail_request",
		"search_crm",
		"whoami",
		"list_users",
		"get_workspace",
		"dashboard_summary",
		"list_contacts",
		"get_contact",
		"list_companies",
		"get_company",
		"list_deals",
		"get_deal",
		"timeline",
		"my_tasks",
		"list_fields",
	],
	agent_read: [
		"sales_get_request",
		"sales_pending_requests",
		"search_crm",
		"whoami",
		"list_users",
		"get_workspace",
		"dashboard_summary",
		"list_contacts",
		"get_contact",
		"list_companies",
		"get_company",
		"list_deals",
		"get_deal",
		"timeline",
		"my_tasks",
		"list_fields",
	],
	legacy: [
		"search_crm",
		"whoami",
		"list_users",
		"get_workspace",
		"dashboard_summary",
		"list_contacts",
		"get_contact",
		"create_contact",
		"update_contact",
		"enrich_contact",
		"list_companies",
		"get_company",
		"create_company",
		"update_company",
		"enrich_company",
		"list_deals",
		"get_deal",
		"create_deal",
		"update_deal",
		"set_deal_stage",
		"attach_contact_to_deal",
		"timeline",
		"my_tasks",
		"log_activity",
		"complete_task",
		"list_fields",
	],
} as const;

const profileTools = {
	crm_integration: [
		...existingProfileTools.crm_integration,
		"resolve_customer",
		"follow_ups",
		"intake_submit",
		"export_csv",
	],
	agent_propose: [
		...existingProfileTools.agent_propose,
		"resolve_customer",
		"follow_ups",
		"export_csv",
	],
	agent_read: [
		...existingProfileTools.agent_read,
		"resolve_customer",
		"follow_ups",
		"export_csv",
	],
	legacy: [
		...existingProfileTools.legacy,
		"resolve_customer",
		"follow_ups",
		"intake_submit",
		"export_csv",
	],
	intake: ["intake_submit"],
} as const;

async function ownedState() {
	return Promise.all([
		db.contact.findMany({
			where: {
				OR: [
					{ id: { startsWith: prefix } },
					{ firstName: { startsWith: prefix } },
				],
			},
			orderBy: { id: "asc" },
		}),
		db.company.findMany({
			where: {
				OR: [{ id: { startsWith: prefix } }, { name: { startsWith: prefix } }],
			},
			orderBy: { id: "asc" },
		}),
		db.deal.findMany({ where: { companyId }, orderBy: { id: "asc" } }),
		db.activity.findMany({
			where: { createdById: userId },
			orderBy: { id: "asc" },
		}),
		db.agentTask.findMany({
			where: { OR: [{ companyId }, { contactId }] },
			orderBy: { id: "asc" },
		}),
		db.dealContact.findMany({
			where: { dealId },
			orderBy: { contactId: "asc" },
		}),
		db.salesRequest.findMany({
			where: { requestedById: userId },
			orderBy: { id: "asc" },
		}),
		db.salesProposal.findMany({
			where: { proposedById: userId },
			orderBy: { id: "asc" },
		}),
	]);
}

describe("MCP profile discovery", () => {
	it("P1 lists the literal enforced tool set for every key profile and legacy", async () => {
		for (const profile of [
			"crm_integration",
			"agent_propose",
			"agent_read",
			"intake",
			"legacy",
		] as const) {
			const key = await createKey(profile === "legacy" ? undefined : profile);
			const client = await connect({ authorization: `Bearer ${key.key}` });
			verifySpy.mockClear();
			const { tools } = await client.listTools();
			expect(verifySpy).toHaveBeenCalledTimes(1);
			expect(tools.map((tool) => tool.name).sort()).toEqual(
				[...profileTools[profile]].sort(),
			);
		}
	});

	it("F4 P2 denies every hidden reader, integration and legacy tool without persisted effects", async () => {
		const requestId = randomUUID();
		const args = new Map<string, CallToolRequest["params"]["arguments"]>([
			[
				"sales_create_request",
				{
					source: "synthetic",
					candidateIds: [contactId],
					expectedUpdatedAt: new Date().toISOString(),
					profileId: "qwen-local-experimental",
					profileRevision: "sales-qwen-v1",
				},
			],
			["sales_get_request", { requestId }],
			["sales_pending_requests", {}],
			[
				"sales_store_proposal",
				{
					requestId,
					producedBy: "synthetic",
					operations: [
						{
							type: "create_note",
							contactId,
							field: null,
							value: "synthetic",
							evidence: "synthetic",
						},
					],
				},
			],
			["sales_fail_request", { requestId }],
			["create_contact", { firstName: `${prefix} forbidden` }],
			[
				"update_contact",
				{ id: contactId, data: { firstName: `${prefix} changed` } },
			],
			["enrich_contact", { id: contactId }],
			["create_company", { name: `${prefix} forbidden` }],
			[
				"update_company",
				{ id: companyId, data: { name: `${prefix} changed` } },
			],
			["enrich_company", { id: companyId }],
			[
				"create_deal",
				{ name: `${prefix} forbidden`, companyId, ownerId: userId },
			],
			["update_deal", { id: dealId, data: { name: `${prefix} changed` } }],
			["set_deal_stage", { id: dealId, stage: "WON" }],
			["attach_contact_to_deal", { dealId, contactId }],
			["log_activity", { type: "NOTE", body: "synthetic", contactId }],
			["complete_task", { id: `${prefix}-task`, completed: true }],
			["intake_submit", { email: `denied@${prefix}.test` }],
			["search_crm", { q: prefix }],
			["resolve_customer", { domain: `${prefix}.test` }],
			["whoami", {}],
			["list_users", {}],
			["get_workspace", {}],
			["dashboard_summary", {}],
			["list_contacts", {}],
			["get_contact", { id: contactId }],
			["list_companies", {}],
			["get_company", { id: companyId }],
			["list_deals", {}],
			["get_deal", { id: dealId }],
			["timeline", { contactId }],
			["my_tasks", {}],
			["follow_ups", { timeZone: "UTC", days: 1 }],
			["list_fields", { entity: "CONTACT" }],
		]);
		await db.activity.create({
			data: {
				id: `${prefix}-task`,
				type: "TASK",
				subject: "synthetic",
				contactId,
				createdById: userId,
			},
		});
		for (const profile of [
			"agent_read",
			"crm_integration",
			"intake",
			"legacy",
		] as const) {
			const key = await createKey(profile === "legacy" ? undefined : profile);
			const client = await connect({ "x-api-key": key.key });
			const visible: readonly string[] = profileTools[profile];
			for (const tool of MCP_TOOLS.filter(
				(tool) => !visible.includes(tool.name),
			)) {
				expect(args.has(tool.name)).toBe(true);
				const before = await ownedState();
				const result = await call(client, {
					name: tool.name,
					arguments: args.get(tool.name),
				});
				expect({
					name: tool.name,
					isError: result.isError,
					text: result.content[0]?.text,
				}).toMatchObject({
					name: tool.name,
					isError: true,
					text: expect.stringContaining("FORBIDDEN:"),
				});
				expect(result.content[0]?.text).toStartWith("FORBIDDEN:");
				expect(await ownedState()).toEqual(before);
			}
		}
	});

	it("an intake key files a lead through intake_submit", async () => {
		const key = await createKey("intake");
		const client = await connect({ authorization: `Bearer ${key.key}` });
		const email = `Lead@${prefix}.test`;
		const result = await call(client, {
			name: "intake_submit",
			arguments: { email, firstName: `${prefix} lead`, source: "mcp-test" },
		});
		expect(result.isError).not.toBe(true);
		const filed = z
			.object({
				status: z.literal("accepted"),
				contactId: z.string(),
				created: z.literal(true),
			})
			.parse(JSON.parse(z.string().parse(result.content[0]?.text)));
		const contact = await db.contact.findUnique({
			where: { id: filed.contactId },
			select: { email: true, source: true },
		});
		expect(contact).toEqual({ email: email.toLowerCase(), source: "INTAKE" });
		const denied = await call(client, {
			name: "get_contact",
			arguments: { id: filed.contactId },
		});
		expect(denied.content[0]?.text).toStartWith("FORBIDDEN:");
		const http = (path: string, body: Record<string, string>) =>
			fetch(new URL(`/api/trpc/${path}`, endpoint), {
				method: "POST",
				headers: {
					authorization: `Bearer ${key.key}`,
					"content-type": "application/json",
				},
				body: JSON.stringify(body),
			});
		const second = await http("intake.submit", { email });
		expect(second.status).toBe(200);
		expect(
			z
				.object({
					result: z.object({
						data: z.object({ created: z.literal(false) }),
					}),
				})
				.safeParse(await second.json()).success,
		).toBe(true);
		const other = await http("contacts.create", { firstName: "Denied" });
		expect(other.status).toBe(403);
		await db.agentTask.deleteMany({ where: { contactId: filed.contactId } });
	});

	it("P3 lists every tool for a cookie session", async () => {
		const client = await connect({ cookie });
		verifySpy.mockClear();
		expect(
			(await client.listTools()).tools.map((tool) => tool.name).sort(),
		).toEqual(MCP_TOOLS.map((tool) => tool.name).sort());
		expect(verifySpy).not.toHaveBeenCalled();
	});

	it("F4 every visible sales query reaches read enforcement without a visible mutation", async () => {
		for (const profile of [
			"crm_integration",
			"agent_propose",
			"agent_read",
			"legacy",
		] as const) {
			const key = await createKey(profile === "legacy" ? undefined : profile);
			const client = await connect({ "x-api-key": key.key });
			const tools = (await client.listTools()).tools.filter(
				(tool) =>
					tool.name.startsWith("sales_") && tool.annotations?.readOnlyHint,
			);
			expect(tools.map((tool) => tool.name).sort()).toEqual(
				profile === "legacy"
					? []
					: ["sales_get_request", "sales_pending_requests"],
			);
			for (const tool of tools) {
				const before = await ownedState();
				const result = await call(client, {
					name: tool.name,
					arguments:
						tool.name === "sales_get_request"
							? { requestId: randomUUID() }
							: {},
				});
				if (tool.name === "sales_get_request") {
					expect(result.isError).toBe(true);
					expect(result.content[0]?.text).toStartWith("NOT_FOUND:");
				} else {
					expect(result.isError).not.toBe(true);
					expect(
						salesPendingOutput.safeParse(
							JSON.parse(z.string().parse(result.content[0]?.text)),
						).success,
					).toBe(true);
				}
				expect(await ownedState()).toEqual(before);
			}
		}
	});

	it("F4 cross-user cookies preserve key-owner precedence for discovery and calls", async () => {
		const response = await fixture.handler(
			new Request("http://localhost:3001/api/auth/sign-up/email", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					name: "Other fixture",
					email: `other-${prefix}@example.com`,
					password: "synthetic-password-long-enough",
				}),
			}),
		);
		expect(response.status).toBe(200);
		const otherId = z
			.object({ user: z.object({ id: z.string() }) })
			.parse(await response.json()).user.id;
		extraUserIds.push(otherId);
		await db.user.create({
			data: {
				id: otherId,
				name: "Other fixture",
				email: `other-${prefix}@example.com`,
			},
		});
		const otherCookie = response.headers
			.getSetCookie()
			.map((value) => value.split(";")[0])
			.join("; ");
		const otherKey = await fixture.api.createApiKey({
			body: {
				userId: otherId,
				name: "Other synthetic key",
				permissions: KEY_PERMISSIONS.agent_read,
			},
		});
		for (const [sessionCookie, key, expectedId] of [
			[cookie, otherKey.key, otherId],
			[otherCookie, readerKey.key, userId],
		] as const) {
			const headers = new Headers({ cookie: sessionCookie, "x-api-key": key });
			expect((await fixture.api.getSession({ headers }))?.user.id).toBe(
				expectedId,
			);
			for (const [name, value] of [
				["x-api-key", key],
				["authorization", `Bearer ${key}`],
			] as const) {
				const requestHeaders = new Headers({ cookie: sessionCookie });
				requestHeaders.set(name, value);
				const client = await connect(requestHeaders);
				expect(
					(await client.listTools()).tools.map((tool) => tool.name).sort(),
				).toEqual([...profileTools.agent_read].sort());
				const who = await call(client, { name: "whoami", arguments: {} });
				expect(who.isError).not.toBe(true);
				expect(
					z
						.object({ id: z.string() })
						.parse(JSON.parse(z.string().parse(who.content[0]?.text))).id,
				).toBe(expectedId);
				const missing = await call(client, {
					name: "sales_get_request",
					arguments: { requestId: randomUUID() },
				});
				expect(missing.content[0]?.text).toStartWith("NOT_FOUND:");
				const before = await ownedState();
				const denied = await call(client, {
					name: "update_contact",
					arguments: { id: contactId, data: { firstName: "Denied" } },
				});
				expect(denied.content[0]?.text).toStartWith("FORBIDDEN:");
				expect(await ownedState()).toEqual(before);
			}
		}
	});

	it("a cookie does not widen the accompanying reader key", async () => {
		const client = await connect({ cookie, "x-api-key": readerKey.key });
		expect(
			(await client.listTools()).tools.map((tool) => tool.name).sort(),
		).toEqual([...profileTools.agent_read].sort());
		const before = await ownedState();
		const result = await call(client, {
			name: "update_contact",
			arguments: { id: contactId, data: { firstName: "Denied" } },
		});
		expect(result.content[0]?.text).toStartWith("FORBIDDEN:");
		expect(await ownedState()).toEqual(before);
	});
});

const resolvedCustomer = z.strictObject({
	status: z.enum(["resolved", "ambiguous", "not_found", "invalid"]),
	matches: z.array(
		z.union([
			z.strictObject({
				kind: z.literal("contact"),
				matchType: z.enum(["exact", "case_insensitive"]),
				id: z.string(),
				firstName: z.string(),
				lastName: z.string().nullable(),
				email: z.string().nullable(),
				companyId: z.string().nullable(),
				archivedAt: z.string().nullable(),
			}),
			z.strictObject({
				kind: z.literal("company"),
				matchType: z.literal("exact"),
				id: z.string(),
				name: z.string(),
				domain: z.string().nullable(),
				archivedAt: z.string().nullable(),
			}),
		]),
	),
	truncated: z.boolean(),
});

async function resolve(args: CallToolRequest["params"]["arguments"]) {
	const before = await ownedState();
	const result = await read("resolve_customer", args, resolvedCustomer);
	expect(await ownedState()).toEqual(before);
	return result;
}

describe("MCP exact customer lookup", () => {
	it("F3 rejects oversized raw email and domain values before lookup", async () => {
		const lookupSpy = spyOn(app.get(SearchService), "resolveCustomer");
		try {
			for (const args of [
				{ email: `active@${prefix}.test`.padStart(321, " ") },
				{ domain: `https://${prefix}.test/`.padEnd(2049, "x") },
			]) {
				const result = await call(reader, {
					name: "resolve_customer",
					arguments: args,
				});
				expect(result.isError).toBe(true);
				expect(result.content[0]?.text).toStartWith("BAD_REQUEST:");
				expect(lookupSpy).not.toHaveBeenCalled();
			}
		} finally {
			lookupSpy.mockRestore();
		}
		expect(
			(
				await resolve({ email: `active@${prefix}.test`.padStart(320, " ") })
			).matches.map((match) => match.id),
		).toEqual([contactId]);
		expect(
			(
				await resolve({ domain: `https://${prefix}.test/`.padEnd(2048, "x") })
			).matches.map((match) => match.id),
		).toEqual([companyId]);
	});

	it("F5 keeps strict lookup validation and supports literal-ID fallback for nonstandard stored emails", async () => {
		for (const email of [
			"ana@localhost",
			"not-an-email",
			"ana@@example.test",
		]) {
			await db.contact.update({ where: { id: contactId }, data: { email } });
			expect(await resolve({ email })).toEqual({
				status: "invalid",
				matches: [],
				truncated: false,
			});
			expect(
				await read(
					"get_contact",
					{ id: contactId },
					z.object({ id: z.string(), email: z.string() }),
				),
			).toEqual({ id: contactId, email });
		}
	});
	it("F1 treats underscores literally instead of matching other characters", async () => {
		await db.contact.update({
			where: { id: contactId },
			data: { email: `aXb@${prefix}.test` },
		});
		expect(await resolve({ email: `a_b@${prefix}.test` })).toEqual({
			status: "not_found",
			matches: [],
			truncated: false,
		});
		await db.contact.create({
			data: {
				id: `${prefix}-five-characters`,
				firstName: "Synthetic",
				email: `abcde@${prefix}.test`,
			},
		});
		expect(await resolve({ email: `_____@${prefix}.test` })).toEqual({
			status: "not_found",
			matches: [],
			truncated: false,
		});
	});

	it("F1 resolves literal underscores with original-spelling classification", async () => {
		await db.contact.update({
			where: { id: contactId },
			data: { email: `a_b@${prefix}.test` },
		});
		await db.contact.create({
			data: {
				id: `${prefix}-wildcard-twin`,
				firstName: "Synthetic",
				email: `aXb@${prefix}.test`,
			},
		});
		const mixed = await resolve({ email: `A_B@${prefix}.test` });
		expect(mixed.status).toBe("resolved");
		expect(mixed.matches.map((match) => [match.id, match.matchType])).toEqual([
			[contactId, "case_insensitive"],
		]);
		expect(
			(await resolve({ email: `a_b@${prefix}.test` })).matches[0]?.matchType,
		).toBe("exact");
	});

	it("F1 F5 keeps quotes literal and preserves strict percent validation", async () => {
		for (const [local, status] of [
			["a%b", "invalid"],
			["a'b", "resolved"],
		] as const) {
			const email = `${local}@${prefix}.test`;
			await db.contact.update({
				where: { id: contactId },
				data: { email: `aXb@${prefix}.test` },
			});
			expect(await resolve({ email })).toEqual({
				status: status === "invalid" ? "invalid" : "not_found",
				matches: [],
				truncated: false,
			});
			await db.contact.update({ where: { id: contactId }, data: { email } });
			const result = await resolve({ email });
			expect(result.status).toBe(status);
			expect(
				result.matches.map((match) => [match.id, match.matchType]),
			).toEqual(status === "invalid" ? [] : [[contactId, "exact"]]);
			expect(
				await read(
					"get_contact",
					{ id: contactId },
					z.object({ id: z.string(), email: z.string() }),
				),
			).toEqual({ id: contactId, email });
		}
	});

	it("F1 preserves archive partition, ambiguity and truncation with underscore distractors", async () => {
		const email = `a_b@${prefix}.test`;
		await db.contact.update({ where: { id: contactId }, data: { email } });
		await db.contact.createMany({
			data: Array.from({ length: 30 }, (_, index) => ({
				id: `${prefix}-000-distractor-${index}`,
				firstName: "Synthetic",
				email: `a${index}b@${prefix}.test`,
				archivedAt: new Date(),
			})),
		});
		await db.contact.createMany({
			data: Array.from({ length: 26 }, (_, index) => ({
				id: `${prefix}-underscore-${String(index).padStart(2, "0")}`,
				firstName: "Synthetic",
				email,
				archivedAt: new Date(),
			})),
		});
		expect((await resolve({ email })).matches.map((match) => match.id)).toEqual(
			[contactId],
		);
		const archived = await resolve({ email, archived: true });
		expect(archived.status).toBe("ambiguous");
		expect(archived.truncated).toBe(true);
		expect(archived.matches.map((match) => match.id)).toEqual(
			Array.from(
				{ length: 25 },
				(_, index) => `${prefix}-underscore-${String(index).padStart(2, "0")}`,
			),
		);
	});

	it("I1 rejects names and resolves equal names by distinct email", async () => {
		const otherId = `${prefix}-other-contact`;
		await db.contact.create({
			data: {
				id: otherId,
				firstName: `${prefix} active`,
				email: `other@${prefix}.test`,
			},
		});
		const rejected = await call(reader, {
			name: "resolve_customer",
			arguments: { name: `${prefix} active` },
		});
		expect(rejected.isError).toBe(true);
		expect(rejected.content[0]?.text).toStartWith("BAD_REQUEST:");
		expect(rejected.content[0]?.text).toContain("search_crm");
		expect(
			MCP_TOOLS.find((tool) => tool.name === "resolve_customer")?.description,
		).toContain("search_crm");
		expect(
			(await resolve({ email: `active@${prefix}.test` })).matches.map(
				(row) => row.id,
			),
		).toEqual([contactId]);
		expect(
			(await resolve({ email: `other@${prefix}.test` })).matches.map(
				(row) => row.id,
			),
		).toEqual([otherId]);
	});

	it("I2 preserves original spelling when reporting exact and case-insensitive matches", async () => {
		const canonical = `ana@${prefix}.test`;
		await db.contact.update({
			where: { id: contactId },
			data: { email: canonical },
		});
		expect(
			(await resolve({ email: `Ana@${prefix.toUpperCase()}.test` })).matches[0]
				?.matchType,
		).toBe("case_insensitive");
		expect((await resolve({ email: canonical })).matches[0]?.matchType).toBe(
			"exact",
		);
		const mixed = `MiXeD@${prefix}.test`;
		await db.contact.update({
			where: { id: contactId },
			data: { email: mixed },
		});
		expect((await resolve({ email: mixed })).matches[0]?.matchType).toBe(
			"exact",
		);
		expect(
			(await resolve({ email: mixed.toLowerCase() })).matches[0]?.matchType,
		).toBe("case_insensitive");
		expect((await resolve({ email: ` ${mixed} ` })).matches[0]?.matchType).toBe(
			"case_insensitive",
		);
	});

	it("I3 does not strip plus tags or dots or infer a company from email", async () => {
		expect(await resolve({ email: `active+crm@${prefix}.test` })).toEqual({
			status: "not_found",
			matches: [],
			truncated: false,
		});
		expect((await resolve({ email: `act.ive@${prefix}.test` })).status).toBe(
			"not_found",
		);
		expect(
			(await resolve({ email: `missing@${prefix}.test` })).matches,
		).toEqual([]);
	});

	it("I4 returns only the explicitly selected archive partition without hidden hints", async () => {
		const email = `active@${prefix}.test`;
		await db.contact.update({
			where: { id: contactId },
			data: { archivedAt: new Date() },
		});
		expect(await resolve({ email })).toEqual({
			status: "not_found",
			matches: [],
			truncated: false,
		});
		expect(
			(await resolve({ email, archived: true })).matches.map((row) => row.id),
		).toEqual([contactId]);
		await db.contact.create({
			data: { id: `${prefix}-active-twin`, firstName: "Twin", email },
		});
		expect((await resolve({ email })).matches.map((row) => row.id)).toEqual([
			`${prefix}-active-twin`,
		]);
		expect(
			(await resolve({ email, archived: true })).matches.map((row) => row.id),
		).toEqual([contactId]);
		await db.company.update({
			where: { id: companyId },
			data: { archivedAt: new Date() },
		});
		expect((await resolve({ domain: `${prefix}.test` })).status).toBe(
			"not_found",
		);
		expect(
			(await resolve({ domain: `${prefix}.test`, archived: true })).matches.map(
				(row) => row.id,
			),
		).toEqual([companyId]);
	});

	it("I5 reuses domain normalization for URL inputs without a free-mail special case", async () => {
		expect(
			(
				await resolve({ domain: `https://www.${prefix.toUpperCase()}.test/x` })
			).matches.map((row) => row.id),
		).toEqual([companyId]);
		expect((await resolve({ domain: "gmail.com" })).status).toBe("not_found");
	});

	it("I6 rejects malformed inputs and multiple identifiers", async () => {
		for (const args of [
			{ email: "" },
			{ email: "@x.test" },
			{ email: "Ana Example" },
			{ email: "ana@@x.test" },
			{ email: "ana@" },
			{ domain: "not a domain" },
			{ domain: "" },
		]) {
			expect(await resolve(args)).toEqual({
				status: "invalid",
				matches: [],
				truncated: false,
			});
		}
		for (const args of [
			{},
			{ email: `active@${prefix}.test`, domain: `${prefix}.test` },
			{ contactId },
		]) {
			const result = await call(reader, {
				name: "resolve_customer",
				arguments: args,
			});
			expect(result.isError).toBe(true);
			expect(result.content[0]?.text).toStartWith("BAD_REQUEST:");
		}
	});

	it("reports ambiguous archived matches and truncates deterministically at 25", async () => {
		const email = `duplicate@${prefix}.test`;
		await db.contact.createMany({
			data: Array.from({ length: 26 }, (_, index) => ({
				id: `${prefix}-duplicate-${String(index).padStart(2, "0")}`,
				firstName: "Duplicate",
				email,
				archivedAt: new Date(),
			})),
		});
		const result = await resolve({ email, archived: true });
		expect(result.status).toBe("ambiguous");
		expect(result.truncated).toBe(true);
		expect(result.matches).toHaveLength(25);
		expect(result.matches.map((row) => row.id)).toEqual(
			Array.from(
				{ length: 25 },
				(_, index) => `${prefix}-duplicate-${String(index).padStart(2, "0")}`,
			),
		);
		expect(await resolve({ email })).toEqual({
			status: "not_found",
			matches: [],
			truncated: false,
		});
	});
});

const followUpResult = z.strictObject({
	asOf: z.iso.datetime(),
	timeZone: z.string(),
	days: z.number(),
	scope: z.literal("created_by_caller"),
	boundaries: z.strictObject({
		todayStart: z.iso.datetime(),
		tomorrowStart: z.iso.datetime(),
		windowEnd: z.iso.datetime(),
	}),
	counts: z.strictObject({
		overdue: z.number(),
		due_today: z.number(),
		next_days: z.number(),
		later: z.number(),
		undated: z.number(),
		total: z.number(),
	}),
	countedAt: z.iso.datetime(),
	items: z.array(
		z.strictObject({
			category: z.enum([
				"overdue",
				"due_today",
				"next_days",
				"later",
				"undated",
			]),
			dueLocalDate: z.string().nullable(),
			task: activityEntryOutput,
		}),
	),
	nextCursor: z.string().nullable(),
});
const followInput = {
	timeZone: "America/New_York",
	days: 3,
	asOf: "2026-10-23T12:00:00Z",
};

async function follow(args: CallToolRequest["params"]["arguments"]) {
	const before = await ownedState();
	const result = await read("follow_ups", args, followUpResult);
	expect(await ownedState()).toEqual(before);
	const { total, ...categories } = result.counts;
	expect(Object.values(categories).reduce((sum, count) => sum + count, 0)).toBe(
		total,
	);
	return result;
}

async function tasks(dates: (string | null)[]) {
	await db.activity.createMany({
		data: dates.map((dueAt, index) => ({
			id: `${prefix}-task-${String(index).padStart(3, "0")}`,
			type: "TASK",
			subject: "Synthetic follow-up",
			dueAt: dueAt ? new Date(dueAt) : null,
			contactId,
			createdById: userId,
		})),
	});
}

describe("MCP deterministic follow-ups", () => {
	it("F2 rejects unsupported asOf instants, including cursor-only replays", async () => {
		await tasks([null, null]);
		const page = await follow({ ...followInput, limit: 1 });
		for (const asOf of [
			"0000-01-01T12:00:00Z",
			"0001-12-31T23:59:59.999Z",
			"9999-01-01T00:00:00Z",
			"9999-12-31T12:00:00Z",
			"0002-01-01T00:00:00+14:00",
			"9998-12-31T23:59:59-12:00",
		]) {
			const explicit = await call(reader, {
				name: "follow_ups",
				arguments: { ...followInput, asOf },
			});
			expect({
				asOf,
				error: explicit.isError,
				text: explicit.content[0]?.text,
			}).toMatchObject({
				error: true,
				text: expect.stringContaining("BAD_REQUEST:"),
			});
			const cursor = Buffer.from(
				JSON.stringify({
					...JSON.parse(
						Buffer.from(
							z.string().parse(page.nextCursor),
							"base64url",
						).toString("utf8"),
					),
					asOf: new Date(asOf).toISOString(),
				}),
			).toString("base64url");
			const replay = await call(reader, {
				name: "follow_ups",
				arguments: {
					timeZone: followInput.timeZone,
					days: followInput.days,
					cursor,
				},
			});
			expect(replay.isError).toBe(true);
			expect(replay.content[0]?.text).toStartWith("BAD_REQUEST:");
		}
	});

	it("F2 preserves ordered boundaries and replay at both supported range edges", async () => {
		await tasks([null, null]);
		for (const [asOf, timeZone] of [
			["0002-01-01T00:00:00Z", "Etc/GMT+12"],
			["9998-12-31T23:59:59.999Z", "Pacific/Kiritimati"],
		]) {
			const first = await follow({ asOf, timeZone, days: 31, limit: 1 });
			expect(Date.parse(first.boundaries.todayStart)).toBeLessThanOrEqual(
				Date.parse(first.asOf),
			);
			expect(Date.parse(first.boundaries.tomorrowStart)).toBeGreaterThan(
				Date.parse(first.asOf),
			);
			expect(Date.parse(first.boundaries.windowEnd)).toBeGreaterThanOrEqual(
				Date.parse(first.boundaries.tomorrowStart),
			);
			const second = await follow({
				timeZone,
				days: 31,
				cursor: first.nextCursor,
			});
			expect(second.asOf).toBe(first.asOf);
			expect(second.boundaries).toEqual(first.boundaries);
			expect(second.counts).toEqual(first.counts);
		}
	});

	it("F2 rejects invalid computed day boundaries instead of returning inconsistent counts", async () => {
		for (const values of [
			["2026-10-23T04:00:00Z", "2026-10-23T11:00:00Z", "2026-10-27T04:00:00Z"],
			["2026-10-23T04:00:00Z", "2026-10-24T04:00:00Z", "2026-10-24T03:00:00Z"],
			["2026-10-23T13:00:00Z", "2026-10-24T04:00:00Z", "2026-10-27T04:00:00Z"],
			["invalid", "2026-10-24T04:00:00Z", "2026-10-27T04:00:00Z"],
		]) {
			let index = 0;
			const boundarySpy = spyOn(localDay, "localDayStart").mockImplementation(
				() => new Date(values[index++] ?? "invalid"),
			);
			try {
				const result = await call(reader, {
					name: "follow_ups",
					arguments: followInput,
				});
				expect(result.isError).toBe(true);
				expect(result.content[0]?.text).toStartWith("BAD_REQUEST:");
			} finally {
				boundarySpy.mockRestore();
			}
		}
	});

	it("F3 rejects oversized zone and timestamp strings", async () => {
		const followSpy = spyOn(app.get(ActivitiesService), "followUps");
		try {
			for (const args of [
				{ ...followInput, timeZone: "A".repeat(65) },
				{ ...followInput, asOf: `2026-10-23T12:00:00.${"0".repeat(50)}Z` },
			]) {
				const result = await call(reader, {
					name: "follow_ups",
					arguments: args,
				});
				expect(result.isError).toBe(true);
				expect(result.content[0]?.text).toStartWith("BAD_REQUEST:");
				expect(followSpy).not.toHaveBeenCalled();
			}
		} finally {
			followSpy.mockRestore();
		}
		expect(
			(
				await follow({
					...followInput,
					asOf: `2026-10-23T12:00:00.${"0".repeat(43)}Z`,
				})
			).asOf,
		).toBe("2026-10-23T12:00:00.000Z");
	});

	it("F2 F3 return HTTP 400 for invalid REST inputs instead of an internal error", async () => {
		const requests = [
			[
				"search/resolve-customer",
				new URLSearchParams({
					email: `active@${prefix}.test`.padStart(321, " "),
				}),
			],
			[
				"activities/follow-ups",
				new URLSearchParams({
					timeZone: "America/New_York",
					days: "3",
					asOf: "9999-12-31T12:00:00Z",
				}),
			],
		] as const;
		for (const [path, query] of requests) {
			const response = await fetch(
				new URL(`/rest/${path}?${query}`, endpoint),
				{ headers: { "x-api-key": readerKey.key } },
			);
			expect(response.status).toBe(400);
			expect(
				z
					.object({ code: z.literal("BAD_REQUEST") })
					.safeParse(await response.json()).success,
			).toBe(true);
		}
	});

	it("T1 compares instants and defines due_today as the remaining local day", async () => {
		await tasks([
			"2026-10-23T04:00:00Z",
			"2026-10-23T20:00:00Z",
			"2026-10-24T04:00:00Z",
			"2026-10-23T12:00:00Z",
			null,
		]);
		const result = await follow(followInput);
		expect(result.boundaries).toEqual({
			todayStart: "2026-10-23T04:00:00.000Z",
			tomorrowStart: "2026-10-24T04:00:00.000Z",
			windowEnd: "2026-10-27T04:00:00.000Z",
		});
		expect(
			result.items.map((item) => [item.category, item.dueLocalDate]),
		).toEqual([
			["overdue", "2026-10-23"],
			["due_today", "2026-10-23"],
			["due_today", "2026-10-23"],
			["next_days", "2026-10-24"],
			["undated", null],
		]);
		expect(result.counts).toEqual({
			overdue: 1,
			due_today: 2,
			next_days: 1,
			later: 0,
			undated: 1,
			total: 5,
		});
		expect(result.asOf).toBe("2026-10-23T12:00:00.000Z");
	});

	it("T2 uses local date boundaries across DST, including the exclusive window end", async () => {
		await tasks(["2026-11-02T04:30:00Z", "2026-11-02T05:00:00Z"]);
		const result = await follow({
			...followInput,
			days: 1,
			asOf: "2026-10-31T16:00:00Z",
		});
		expect(result.boundaries.windowEnd).toBe("2026-11-02T05:00:00.000Z");
		expect(
			result.items.map((item) => [item.category, item.dueLocalDate]),
		).toEqual([
			["next_days", "2026-11-01"],
			["later", "2026-11-02"],
		]);
	});

	it("T3 returns 57 unique tasks on three pages with equal counts and stable ties", async () => {
		await tasks(
			Array.from({ length: 57 }, (_, index) =>
				index < 10
					? "2026-10-22T12:00:00Z"
					: index < 20
						? new Date(Date.UTC(2026, 9, 23, 14, index)).toISOString()
						: index < 40
							? new Date(Date.UTC(2026, 9, 24, 4, index - 20)).toISOString()
							: index < 52
								? "2026-11-01T12:00:00Z"
								: null,
			),
		);
		const first = await follow({ ...followInput, limit: 25 });
		const second = await follow({
			...followInput,
			limit: 25,
			cursor: first.nextCursor,
		});
		const third = await follow({
			...followInput,
			limit: 25,
			cursor: second.nextCursor,
		});
		expect([
			first.items.length,
			second.items.length,
			third.items.length,
		]).toEqual([25, 25, 7]);
		expect(third.nextCursor).toBeNull();
		expect(first.counts).toEqual({
			overdue: 10,
			due_today: 10,
			next_days: 20,
			later: 12,
			undated: 5,
			total: 57,
		});
		expect(second.counts).toEqual(first.counts);
		expect(third.counts).toEqual(first.counts);
		const items = [...first.items, ...second.items, ...third.items];
		expect(new Set(items.map((item) => item.task.id)).size).toBe(57);
		expect(items.map((item) => item.task.id)).toEqual(
			Array.from(
				{ length: 57 },
				(_, index) => `${prefix}-task-${String(index).padStart(3, "0")}`,
			),
		);
	});

	it("T4 continues beyond a completed cursor row and reflects current counts", async () => {
		await tasks(Array.from({ length: 6 }, () => "2026-10-24T12:00:00Z"));
		const first = await follow({ ...followInput, limit: 2 });
		await db.activity.update({
			where: { id: first.items[1]?.task.id },
			data: { completedAt: new Date() },
		});
		const second = await follow({
			...followInput,
			limit: 2,
			cursor: first.nextCursor,
		});
		const third = await follow({
			...followInput,
			limit: 2,
			cursor: second.nextCursor,
		});
		expect(second.counts.total).toBe(5);
		expect(third.counts.total).toBe(5);
		expect(
			[...first.items, ...second.items, ...third.items].map(
				(item) => item.task.id,
			),
		).toEqual(
			Array.from(
				{ length: 6 },
				(_, index) => `${prefix}-task-${String(index).padStart(3, "0")}`,
			),
		);
	});

	it("T5 filters by the authenticated creator and binds the cursor to that creator", async () => {
		await tasks([null, null]);
		const other = await fixture.api.signUpEmail({
			body: {
				name: "Other fixture",
				email: `other-${prefix}@example.com`,
				password: "synthetic-password-long-enough",
			},
		});
		extraUserIds.push(other.user.id);
		await db.user.create({
			data: {
				id: other.user.id,
				name: "Other fixture",
				email: `other-${prefix}@example.com`,
			},
		});
		await db.activity.create({
			data: {
				id: `${prefix}-other-task`,
				type: "TASK",
				createdById: other.user.id,
				companyId,
			},
		});
		const first = await follow({ ...followInput, limit: 1 });
		expect(first.counts.total).toBe(2);
		const key = await fixture.api.createApiKey({
			body: {
				userId: other.user.id,
				name: "Other synthetic key",
				permissions: KEY_PERMISSIONS.agent_read,
			},
		});
		const client = await connect({ "x-api-key": key.key });
		const result = wireResult.parse(
			await client.callTool({ name: "follow_ups", arguments: followInput }),
		);
		expect(result.isError).not.toBe(true);
		expect(
			followUpResult
				.parse(JSON.parse(z.string().parse(result.content[0]?.text)))
				.items.map((item) => item.task.id),
		).toEqual([`${prefix}-other-task`]);
		const rejected = await call(client, {
			name: "follow_ups",
			arguments: { ...followInput, cursor: first.nextCursor },
		});
		expect(rejected.content[0]?.text).toStartWith("BAD_REQUEST:");
	});

	it("T6 excludes completed tasks and every direct archived link without a parent cascade", async () => {
		await tasks([null]);
		const archivedCompany = `${prefix}-archived-company`;
		const archivedContact = `${prefix}-archived-contact`;
		const archivedDeal = `${prefix}-archived-deal`;
		await db.company.create({
			data: {
				id: archivedCompany,
				name: "Archived fixture",
				archivedAt: new Date(),
			},
		});
		await db.contact.create({
			data: {
				id: archivedContact,
				firstName: "Archived fixture",
				archivedAt: new Date(),
			},
		});
		await db.deal.create({
			data: {
				id: archivedDeal,
				name: "Archived fixture",
				companyId,
				ownerId: userId,
				archivedAt: new Date(),
			},
		});
		await db.activity.createMany({
			data: [
				{
					id: `${prefix}-archived-company-task`,
					type: "TASK",
					createdById: userId,
					companyId: archivedCompany,
				},
				{
					id: `${prefix}-archived-contact-task`,
					type: "TASK",
					createdById: userId,
					contactId: archivedContact,
				},
				{
					id: `${prefix}-archived-deal-task`,
					type: "TASK",
					createdById: userId,
					dealId: archivedDeal,
				},
				{
					id: `${prefix}-mixed-task`,
					type: "TASK",
					createdById: userId,
					contactId,
					companyId: archivedCompany,
				},
				{
					id: `${prefix}-completed-task`,
					type: "TASK",
					createdById: userId,
					contactId,
					completedAt: new Date(),
				},
				{ id: `${prefix}-note`, type: "NOTE", createdById: userId, contactId },
			],
		});
		await db.contact.update({
			where: { id: contactId },
			data: { companyId: archivedCompany },
		});
		expect(
			(await follow(followInput)).items.map((item) => item.task.id),
		).toEqual([`${prefix}-task-000`]);
	});

	it("T7 rejects invalid zones, dates, bounds and mismatched or malformed cursors", async () => {
		await tasks([null, null, null]);
		const first = await follow({ ...followInput, limit: 1 });
		for (const args of [
			{ days: 3 },
			{ timeZone: "UTC" },
			{ ...followInput, timeZone: "Not/AZone" },
			{ ...followInput, timeZone: "+05:30" },
			{ ...followInput, days: 0 },
			{ ...followInput, days: 32 },
			{ ...followInput, days: 1.5 },
			{ ...followInput, limit: 101 },
			{ ...followInput, asOf: "2026-10-23T12:00:00" },
			{ ...followInput, asOf: "2026-02-30T12:00:00Z" },
			{ ...followInput, days: 2, cursor: first.nextCursor },
			{ ...followInput, timeZone: "UTC", cursor: first.nextCursor },
			{
				...followInput,
				asOf: "2026-10-24T12:00:00Z",
				cursor: first.nextCursor,
			},
			{ ...followInput, cursor: "not-a-cursor" },
			{ ...followInput, cursor: Buffer.from("{}").toString("base64url") },
		]) {
			const result = await call(reader, {
				name: "follow_ups",
				arguments: args,
			});
			expect({
				args,
				error: result.isError,
				text: result.content[0]?.text,
			}).toMatchObject({
				error: true,
				text: expect.stringContaining("BAD_REQUEST:"),
			});
		}
	});

	it("echoes server now once and preserves it through a cursor without an explicit asOf", async () => {
		await tasks([null, null, null]);
		const before = Date.now();
		const first = await follow({ timeZone: "UTC", days: 1, limit: 1 });
		expect(Date.parse(first.asOf)).toBeGreaterThanOrEqual(before);
		expect(Date.parse(first.asOf)).toBeLessThanOrEqual(Date.now());
		const second = await follow({
			timeZone: "UTC",
			days: 1,
			limit: 2,
			cursor: first.nextCursor,
		});
		expect(second.asOf).toBe(first.asOf);
		expect(second.items).toHaveLength(2);
		expect(second.nextCursor).toBeNull();
	});

	it("preserves the my_tasks behavior, including tasks on archived records", async () => {
		await tasks(["2020-01-01T00:00:00Z"]);
		await db.contact.update({
			where: { id: contactId },
			data: { archivedAt: new Date() },
		});
		expect((await follow(followInput)).counts.total).toBe(0);
		expect(
			(
				await read(
					"my_tasks",
					{ window: "overdue" },
					z.array(activityEntryOutput),
				)
			).map((task) => task.id),
		).toEqual([`${prefix}-task-000`]);
	});

	it("exposes both queries through the authenticated REST bridge and OpenAPI", async () => {
		const before = await ownedState();
		const lookup = new URL("/rest/search/resolve-customer", endpoint);
		lookup.searchParams.set("email", `active@${prefix}.test`);
		const lookupResponse = await fetch(lookup, {
			headers: { "x-api-key": readerKey.key },
		});
		expect(lookupResponse.status).toBe(200);
		expect(
			resolvedCustomer
				.parse(await lookupResponse.json())
				.matches.map((row) => row.id),
		).toEqual([contactId]);
		const upcoming = new URL("/rest/activities/follow-ups", endpoint);
		for (const [key, value] of Object.entries(followInput))
			upcoming.searchParams.set(key, String(value));
		const upcomingResponse = await fetch(upcoming, {
			headers: { "x-api-key": readerKey.key },
		});
		expect(upcomingResponse.status).toBe(200);
		expect(
			followUpResult.parse(await upcomingResponse.json()).counts.total,
		).toBe(0);
		const openapiResponse = await fetch(new URL("/openapi.json", endpoint));
		expect(openapiResponse.status).toBe(200);
		const spec = z
			.object({
				paths: z.record(z.string(), z.object({ get: z.object({}).optional() })),
			})
			.parse(await openapiResponse.json());
		expect(spec.paths["/search/resolve-customer"]?.get).toBeDefined();
		expect(spec.paths["/activities/follow-ups"]?.get).toBeDefined();
		expect(await ownedState()).toEqual(before);
	});
});
