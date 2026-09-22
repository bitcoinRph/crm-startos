import { describe, expect, it, mock } from "bun:test";
import type { MiddlewareOptions } from "nestjs-trpc";
import { KEY_PERMISSIONS } from "../src/api-keys/api-key-profiles";
import {
	authorizeApiKeyProcedure,
	keyFromHeaders,
	type VerifiedApiKey,
} from "../src/trpc/api-key-access";
import { SessionOnlyMiddleware } from "../src/trpc/middlewares/session-only.middleware";

const scoped = (permissions: Record<string, string[]>): VerifiedApiKey => ({
	referenceId: "member-1",
	permissions,
});

const legacy: VerifiedApiKey = {
	referenceId: "member-1",
	permissions: null,
};

const sessionOnly = new SessionOnlyMiddleware();

type TestHeaders = Record<string, string | string[] | undefined>;

function sessionRequest(headers: TestHeaders) {
	const next = mock(async () => ({ ok: true, data: null }));
	const opts = {
		ctx: {
			req: { headers },
			session: { user: { id: "human" }, session: { id: "session" } },
		},
		path: "apiKeys.list",
		type: "query",
		next,
	} as unknown as MiddlewareOptions;
	return { opts, next };
}

describe("API key transport normalization", () => {
	it("uses the explicit key header before a bearer token", () => {
		expect(
			keyFromHeaders({
				"x-api-key": "crm_header",
				authorization: "Bearer crm_bearer",
			}),
		).toBe("crm_header");
	});

	it("accepts only CRM bearer keys", () => {
		expect(keyFromHeaders({ authorization: "Bearer crm_fixture" })).toBe(
			"crm_fixture",
		);
		expect(
			keyFromHeaders({ authorization: "Bearer session-token" }),
		).toBeNull();
		expect(keyFromHeaders({ authorization: "Basic crm_fixture" })).toBeNull();
		expect(keyFromHeaders({})).toBeNull();
	});
});

describe("session-only API key management", () => {
	it("denies x-api-key and Bearer credentials with or without a cookie", async () => {
		for (const keyHeader of [
			{ "x-api-key": "crm_fixture" },
			{ authorization: "Bearer crm_fixture" },
		]) {
			for (const cookie of [undefined, "human-cookie"]) {
				const headers = cookie ? { ...keyHeader, cookie } : keyHeader;
				const { opts, next } = sessionRequest(headers);
				await expect(sessionOnly.use(opts)).rejects.toMatchObject({
					code: "UNAUTHORIZED",
				});
				expect(next).not.toHaveBeenCalled();
			}
		}
	});

	it("allows a human session without an API key", async () => {
		const { opts, next } = sessionRequest({ cookie: "human-cookie" });
		await expect(sessionOnly.use(opts)).resolves.toEqual({
			ok: true,
			data: null,
		});
		expect(next).toHaveBeenCalledTimes(1);
	});
});

describe("API key access policy", () => {
	it("keeps legacy unscoped keys on their full access", () => {
		expect(authorizeApiKeyProcedure(legacy, "contacts.list", "query")).toBe(
			"allow",
		);
		expect(
			authorizeApiKeyProcedure(legacy, "contacts.update", "mutation"),
		).toBe("allow");
	});

	it("lets a read-only profile read and nothing else", () => {
		const key = scoped(KEY_PERMISSIONS.agent_read);
		expect(authorizeApiKeyProcedure(key, "contacts.list", "query")).toBe(
			"allow",
		);
		expect(authorizeApiKeyProcedure(key, "contacts.update", "mutation")).toBe(
			"deny",
		);
	});

	it("lets a propose profile read the CRM but not write it", () => {
		const key = scoped(KEY_PERMISSIONS.agent_propose);
		expect(authorizeApiKeyProcedure(key, "companies.byId", "query")).toBe(
			"allow",
		);
		expect(authorizeApiKeyProcedure(key, "companies.update", "mutation")).toBe(
			"deny",
		);
	});

	it("lets an integration profile read and write", () => {
		const key = scoped(KEY_PERMISSIONS.crm_integration);
		expect(authorizeApiKeyProcedure(key, "contacts.update", "mutation")).toBe(
			"allow",
		);
	});

	it("denies every key access to API key management", () => {
		for (const key of [
			legacy,
			scoped(KEY_PERMISSIONS.crm_integration),
			scoped(KEY_PERMISSIONS.agent_propose),
		]) {
			for (const [path, type] of [
				["apiKeys.list", "query"],
				["apiKeys.create", "mutation"],
				["apiKeys.revoke", "mutation"],
			] as const) {
				expect(authorizeApiKeyProcedure(key, path, type)).toBe("deny");
			}
		}
	});
});
