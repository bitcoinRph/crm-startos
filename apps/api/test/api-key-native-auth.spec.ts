import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	mock,
	spyOn,
} from "bun:test";
import { auth, DAY_SECONDS } from "@crm/auth";
import type { Db } from "@crm/db";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import type { Request as ExpressRequest } from "express";
import type { MiddlewareOptions } from "nestjs-trpc";
import { z } from "zod";
import {
	API_KEY_PROFILES,
	KEY_PERMISSIONS,
} from "../src/api-keys/api-key-profiles";
import { ApiKeysService } from "../src/api-keys/api-keys.service";
import { keyFromHeaders } from "../src/trpc/api-key-access";
import { AuthMiddleware } from "../src/trpc/middlewares/auth.middleware";
import { createBaseTrpcContext } from "../src/trpc/trpc.context";

function testAuth() {
	return betterAuth({
		...auth.options,
		baseURL: "http://localhost:3001",
		secret: "native-auth-regression-secret-at-least-32-characters",
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

let fixture: ReturnType<typeof testAuth>;
let userId: string;
let cookie: string;
let createSpy:
	| ReturnType<typeof spyOn<typeof auth.api, "createApiKey">>
	| undefined;

beforeEach(async () => {
	fixture = testAuth();
	const response = await fixture.handler(
		new Request("http://localhost:3001/api/auth/sign-up/email", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				name: "Key owner",
				email: "owner@example.com",
				password: "test-password-long-enough",
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
});

afterEach(() => {
	createSpy?.mockRestore();
	createSpy = undefined;
});

function transports(key: string): Record<string, string>[] {
	return [{ "x-api-key": key }, { authorization: `Bearer ${key}` }];
}

async function createKey(profile?: (typeof API_KEY_PROFILES)[number]) {
	return fixture.api.createApiKey({
		body: {
			userId,
			name: "Regression key",
			permissions: profile ? KEY_PERMISSIONS[profile] : undefined,
		},
	});
}

describe("native Better Auth API key boundary", () => {
	it("preserves key sessions and server verification for every profile and legacy keys", async () => {
		for (const profile of [...API_KEY_PROFILES, undefined]) {
			const key = await createKey(profile);
			for (const transport of transports(key.key)) {
				const normalized = keyFromHeaders(transport);
				expect(normalized).toBe(key.key);
				const session = await fixture.api.getSession({
					headers: new Headers({ "x-api-key": z.string().parse(normalized) }),
				});
				expect(session?.user.id).toBe(userId);
				expect(session?.session.id).toBe(key.id);
			}
			const verified = await fixture.api.verifyApiKey({
				body: { key: key.key },
			});
			expect(verified.valid).toBe(true);
			expect(verified.key?.referenceId).toBe(userId);
		}
	});

	it("never exchanges a key session for a reusable browser cookie", async () => {
		const key = await createKey("agent_read");
		for (const query of [
			"",
			"?disableCookieCache=true",
			"?disableRefresh=true",
		]) {
			const response = await fixture.handler(
				new Request(`http://localhost:3001/api/auth/get-session${query}`, {
					headers: { "x-api-key": key.key },
				}),
			);
			expect(response.status).toBe(200);
			expect(response.headers.getSetCookie()).toEqual([]);
			const replay = await fixture.handler(
				new Request("http://localhost:3001/api/auth/api-key/list", {
					headers: { cookie: response.headers.getSetCookie().join("; ") },
				}),
			);
			expect(replay.status).toBe(401);
		}
	});

	it("denies native management for keys, including mixed cookie credentials", async () => {
		const key = await createKey("agent_read");
		const calls = [
			["GET", "/api-key/list", undefined],
			["GET", `/api-key/get?id=${key.id}`, undefined],
			["POST", "/api-key/create", { name: "Escalation" }],
			["POST", "/api-key/update", { keyId: key.id, name: "Changed" }],
			["POST", "/api-key/delete", { keyId: key.id }],
			["POST", "/update-user", { name: "Changed" }],
			["GET", "/list-sessions", undefined],
			["POST", "/revoke-sessions", {}],
			["GET", "/list-accounts", undefined],
			["POST", "/get-access-token", { providerId: "google" }],
			["POST", "/unlink-account", { providerId: "google" }],
			["GET", "/organization/list", undefined],
			[
				"POST",
				"/organization/update",
				{ organizationId: "workspace", data: { name: "Changed" } },
			],
			[
				"POST",
				"/organization/update-member-role",
				{ memberId: "owner", role: "member", organizationId: "workspace" },
			],
			["GET", "/sso/providers", undefined],
		] as const;
		for (const transport of transports(key.key)) {
			for (const withCookie of [false, true]) {
				for (const [method, path, body] of calls) {
					const response = await fixture.handler(
						new Request(`http://localhost:3001/api/auth${path}`, {
							method,
							headers: {
								...transport,
								cookie: withCookie ? cookie : "",
								"content-type": "application/json",
							},
							body: body ? JSON.stringify(body) : undefined,
						}),
					);
					expect({
						path,
						status: response.status,
						body: await response.json(),
					}).toMatchObject({
						path,
						status: 403,
						body: {
							message: "API keys can only resolve sessions on the auth API.",
						},
					});
				}
			}
		}
		expect(
			(await fixture.api.verifyApiKey({ body: { key: key.key } })).valid,
		).toBe(true);
		expect(
			(await fixture.api.listApiKeys({ headers: new Headers({ cookie }) }))
				.total,
		).toBe(1);
		expect(
			(await fixture.api.getSession({ headers: new Headers({ cookie }) }))?.user
				.name,
		).toBe("Key owner");
	});

	it("guards direct server calls with key headers before plugin session injection", async () => {
		const key = await createKey("agent_propose");
		await expect(
			fixture.api.createApiKey({
				headers: new Headers({ "x-api-key": key.key }),
				body: { name: "Escalation" },
			}),
		).rejects.toMatchObject({ statusCode: 403 });
		await expect(
			fixture.api.listApiKeys({
				headers: new Headers({ "x-api-key": "invalid" }),
			}),
		).rejects.toMatchObject({
			statusCode: 403,
			body: { message: "API keys can only resolve sessions on the auth API." },
		});
	});

	it("keeps cookie-only native management available", async () => {
		const key = await createKey("agent_read");
		const headers = new Headers({ cookie });
		expect((await fixture.api.listApiKeys({ headers })).total).toBe(1);
		await fixture.api.deleteApiKey({ headers, body: { keyId: key.id } });
		expect((await fixture.api.listApiKeys({ headers })).total).toBe(0);
	});
});

describe("tRPC and MCP shared authentication with the pinned plugin", () => {
	it("resolves both transports and retains read-only scope enforcement", async () => {
		const key = await createKey("agent_read");
		const sessionSpy = spyOn(auth.api, "getSession").mockImplementation(
			fixture.api.getSession,
		);
		const verifySpy = spyOn(auth.api, "verifyApiKey").mockImplementation(
			fixture.api.verifyApiKey,
		);
		try {
			for (const headers of transports(key.key)) {
				const ctx = await createBaseTrpcContext({ headers } as ExpressRequest);
				expect(ctx.session?.user.id).toBe(userId);
				const next = mock(async () => ({ ok: true, data: null }));
				const opts = {
					ctx,
					path: "contacts.list",
					type: "query",
					next,
				} as unknown as MiddlewareOptions;
				await new AuthMiddleware().use(opts);
				expect(next).toHaveBeenCalledTimes(1);
				await expect(
					new AuthMiddleware().use({
						...opts,
						path: "contacts.update",
						type: "mutation",
					}),
				).rejects.toMatchObject({ code: "FORBIDDEN" });
				await expect(
					new AuthMiddleware().use({
						...opts,
						path: "apiKeys.create",
						type: "mutation",
					}),
				).rejects.toMatchObject({ code: "FORBIDDEN" });
				expect(next).toHaveBeenCalledTimes(1);
			}
			await fixture.api.deleteApiKey({
				headers: new Headers({ cookie }),
				body: { keyId: key.id },
			});
			const revokedHeaders: ExpressRequest["headers"] = {
				"x-api-key": key.key,
			};
			const revoked = await createBaseTrpcContext({
				headers: revokedHeaders,
			} as ExpressRequest);
			expect(revoked.session).toBeNull();
		} finally {
			sessionSpy.mockRestore();
			verifySpy.mockRestore();
		}
	});
});

describe("ApiKeysService with the pinned plugin", () => {
	it("reproduces rejection of permissions with client headers", async () => {
		await expect(
			fixture.api.createApiKey({
				headers: new Headers({ cookie }),
				body: { name: "Scoped key", permissions: KEY_PERMISSIONS.agent_read },
			}),
		).rejects.toMatchObject({
			statusCode: 400,
			body: { code: "SERVER_ONLY_PROPERTY" },
		});
	});

	it("creates each profile with the authenticated owner and verifies persisted permissions", async () => {
		createSpy = spyOn(auth.api, "createApiKey").mockImplementation(
			fixture.api.createApiKey,
		);
		const service = new ApiKeysService({} as Db);
		for (const profile of API_KEY_PROFILES) {
			const created = await service.create(userId, {
				name: profile,
				profile,
				expiresInDays: 30,
			});
			expect(created.profile).toBe(profile);
			expect(created.name).toBe(profile);
			expect(
				new Date(z.string().parse(created.expiresAt)).getTime() -
					new Date(created.createdAt).getTime(),
			).toBe(30 * DAY_SECONDS * 1000);
			const verified = await fixture.api.verifyApiKey({
				body: { key: created.key },
			});
			expect(verified.valid).toBe(true);
			expect(verified.key?.referenceId).toBe(userId);
			expect(verified.key?.permissions).toEqual(KEY_PERMISSIONS[profile]);
			expect(createSpy.mock.calls.at(-1)?.[0]).toEqual({
				body: {
					userId,
					name: profile,
					permissions: KEY_PERMISSIONS[profile],
					expiresIn: 30 * DAY_SECONDS,
				},
			});
		}
		const permanent = await service.create(userId, {
			name: "Permanent",
			profile: "agent_read",
			expiresInDays: null,
		});
		expect(permanent.expiresAt).toBeNull();
	});
});
