import { describe, expect, it, mock } from "bun:test";
import type { MiddlewareOptions } from "nestjs-trpc";
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
	});
});

describe("session-only API key management", () => {
	it("denies x-api-key and legacy Bearer credentials with or without a cookie", async () => {
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

describe("API key compatibility policy", () => {
	it("keeps legacy unscoped member keys on baseline CRM procedures", () => {
		expect(authorizeApiKeyProcedure(legacy, "contacts.list", "query")).toBe(
			"allow",
		);
		expect(
			authorizeApiKeyProcedure(legacy, "contacts.update", "mutation"),
		).toBe("allow");
	});

	it("does not broaden a scoped integration key", () => {
		expect(
			authorizeApiKeyProcedure(
				scoped({ crm: ["read"] }),
				"contacts.list",
				"query",
			),
		).toBe("allow");
		expect(
			authorizeApiKeyProcedure(
				scoped({ crm: ["read"] }),
				"contacts.update",
				"mutation",
			),
		).toBe("deny");
		expect(
			authorizeApiKeyProcedure(
				scoped({ crm: ["read", "write"] }),
				"contacts.update",
				"mutation",
			),
		).toBe("allow");
	});

	it("delegates every sales operation to explicit sales scopes", () => {
		for (const key of [legacy, scoped({ crm: ["read", "write"] })]) {
			expect(authorizeApiKeyProcedure(key, "sales.getRequest", "query")).toBe(
				"sales",
			);
			expect(
				authorizeApiKeyProcedure(key, "sales.approveProposal", "mutation"),
			).toBe("sales");
		}
	});

	it("denies every key policy access to API key management", () => {
		for (const key of [legacy, scoped({ crm: ["read", "write"] })]) {
			for (const [path, type] of [
				["apiKeys.list", "query"],
				["apiKeys.create", "mutation"],
			] as const) {
				expect(authorizeApiKeyProcedure(key, path, type)).toBe("deny");
			}
		}
	});
});
