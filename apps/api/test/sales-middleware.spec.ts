import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { API_KEY_HEADER, auth } from "@crm/auth";
import type { MiddlewareOptions } from "nestjs-trpc";
import { salesActor } from "../src/sales/sales.auth";
import { SALES_SCOPES } from "../src/sales/sales.service";
import type { AuthedTrpcContext } from "../src/trpc/context.types";
import { AuthMiddleware } from "../src/trpc/middlewares/auth.middleware";

type Permissions = Record<string, string[]>;
type TestHeaders = Record<string, string | string[] | undefined>;
let verify:
	| ReturnType<typeof spyOn<typeof auth.api, "verifyApiKey">>
	| undefined;

afterEach(() => {
	verify?.mockRestore();
	verify = undefined;
});

function provider(permissions: Permissions | null, referenceId = "human") {
	verify = spyOn(auth.api, "verifyApiKey").mockResolvedValue({
		valid: true,
		key: { referenceId, permissions },
		error: null,
	} as never);
	return verify;
}

function request(headers: TestHeaders, path = "contacts.list", type = "query") {
	const ctx = {
		req: { headers },
		session: { user: { id: "human" }, session: { id: "session" } },
	};
	const next = mock(async () => ({ ok: true, data: null }));
	const opts = { ctx, path, type, next } as unknown as MiddlewareOptions;
	return { opts, next };
}

const middleware = new AuthMiddleware();

describe("ordinary API key authorization", () => {
	it("keeps legacy unscoped member reads and mutations", async () => {
		provider(null);
		for (const [path, type] of [
			["contacts.list", "query"],
			["contacts.update", "mutation"],
		] as const) {
			const { opts } = request({ [API_KEY_HEADER]: "crm_fixture" }, path, type);
			await expect(middleware.use(opts)).resolves.toEqual({
				ok: true,
				data: null,
			});
		}
	});

	it("denies a scoped read key from mutation bypass", async () => {
		provider({ crm: ["read"] });
		const { opts, next } = request(
			{ [API_KEY_HEADER]: "crm_fixture", cookie: "human-cookie" },
			"contacts.update",
			"mutation",
		);
		await expect(middleware.use(opts)).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
		expect(next).not.toHaveBeenCalled();
	});

	it("allows only the stored CRM write scope", async () => {
		provider({ crm: ["read", "write"] });
		const { opts } = request(
			{ authorization: "Bearer crm_fixture" },
			"contacts.update",
			"mutation",
		);
		await expect(middleware.use(opts)).resolves.toEqual({
			ok: true,
			data: null,
		});
		expect(verify).toHaveBeenCalledWith({ body: { key: "crm_fixture" } });
	});

	it("denies a key owned by another member", async () => {
		provider({ crm: ["read"] }, "other");
		const { opts } = request({ [API_KEY_HEADER]: "crm_fixture" });
		await expect(middleware.use(opts)).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
	});

	it("does not treat unrelated authorization as an API key", async () => {
		provider({});
		const { opts } = request({ authorization: "Bearer session-token" });
		await expect(middleware.use(opts)).resolves.toEqual({
			ok: true,
			data: null,
		});
		expect(verify).not.toHaveBeenCalled();
	});
});

describe("sales scope boundary", () => {
	it("requires explicit sales proposal scope", async () => {
		for (const permissions of [
			null,
			{ crm: ["read", "write"] },
			{ sales: ["proposal:write"] },
		] as const) {
			provider(permissions as Permissions | null);
			const { opts } = request(
				{ [API_KEY_HEADER]: "crm_fixture" },
				"sales.storeProposal",
				"mutation",
			);
			opts.next = (async ({ ctx }: { ctx: AuthedTrpcContext }) =>
				salesActor(ctx, SALES_SCOPES.write)) as never;
			if (permissions?.sales?.includes("proposal:write")) {
				await expect(middleware.use(opts)).resolves.toMatchObject({
					kind: "apiKey",
				});
			} else {
				await expect(middleware.use(opts)).rejects.toMatchObject({
					code: "FORBIDDEN",
				});
			}
			verify?.mockRestore();
			verify = undefined;
		}
	});

	it("keeps sales approval human only", async () => {
		provider({ sales: ["approve"] });
		const { opts } = request(
			{ [API_KEY_HEADER]: "crm_fixture", cookie: "human-cookie" },
			"sales.approveProposal",
			"mutation",
		);
		opts.next = (async ({ ctx }: { ctx: AuthedTrpcContext }) =>
			salesActor(ctx, SALES_SCOPES.approve)) as never;
		await expect(middleware.use(opts)).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
	});
});
