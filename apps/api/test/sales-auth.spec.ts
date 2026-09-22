import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { API_KEY_HEADER, auth } from "@crm/auth";
import { approvedSalesProfile } from "@crm/validation/sales";
import { salesActor } from "../src/sales/sales.auth";
import { SalesRouter } from "../src/sales/sales.router";
import { SALES_SCOPES, SalesService } from "../src/sales/sales.service";
import type { AuthedTrpcContext } from "../src/trpc/context.types";

type TestHeaders = Record<string, string | string[] | undefined>;

function withCookie(headers: TestHeaders, include: boolean): TestHeaders {
	const result = { ...headers };
	if (include) result.cookie = "human-cookie";
	return result;
}

const context = (headers: TestHeaders) =>
	({
		req: { headers },
		user: { id: "human" },
		session: { user: { id: "human" }, session: { id: "session" } },
	}) as AuthedTrpcContext;
afterEach(() => {
	mockVerify?.mockRestore();
	mockVerify = undefined;
});
let mockVerify:
	| ReturnType<typeof spyOn<typeof auth.api, "verifyApiKey">>
	| undefined;

type Permissions = Record<string, string[]>;

function verifyPermissions(granted: Permissions, referenceId = "human") {
	mockVerify = spyOn(auth.api, "verifyApiKey").mockResolvedValue({
		valid: true,
		key: { id: "key-1", referenceId, permissions: granted },
		error: null,
	} as never);
	return mockVerify;
}

const deniedPermissions: [string, Permissions][] = [
	["unscoped", {}],
	["wrong resource", { contacts: ["read"] }],
	["wrong action", { sales: ["write"], crm: ["write"] }],
	["proposal write only", { sales: ["proposal:write"] }],
];

describe("sales explicit read permissions", () => {
	for (const [label, permissions] of deniedPermissions) {
		for (const cookie of [false, true]) {
			it(`denies ${label} reads with cookie=${cookie}`, async () => {
				verifyPermissions(permissions);
				await expect(
					salesActor(
						context(withCookie({ [API_KEY_HEADER]: "fixture-key" }, cookie)),
						SALES_SCOPES.read,
					),
				).rejects.toMatchObject({ code: "FORBIDDEN" });
			});
		}
	}

	for (const resource of ["crm", "sales"]) {
		it(`accepts explicit ${resource} read permission`, async () => {
			const verify = verifyPermissions({ [resource]: ["read"] });
			expect(
				await salesActor(
					context({ [API_KEY_HEADER]: "fixture-key" }),
					SALES_SCOPES.read,
				),
			).toEqual({
				kind: "apiKey",
				userId: "human",
				keyId: "key-1",
				scopes: [SALES_SCOPES.read],
			});
			expect(verify).toHaveBeenCalledWith({
				body: { key: "fixture-key" },
			});
		});
	}

	for (const code of ["KEY_EXPIRED", "KEY_DISABLED", "KEY_NOT_FOUND"]) {
		for (const scope of [SALES_SCOPES.read, SALES_SCOPES.write]) {
			it(`denies ${code} for ${scope} despite a cookie`, async () => {
				mockVerify = spyOn(auth.api, "verifyApiKey").mockResolvedValue({
					valid: false,
					key: null,
					error: { code, message: code },
				} as never);
				await expect(
					salesActor(
						context({
							[API_KEY_HEADER]: "fixture-key",
							cookie: "human-cookie",
						}),
						scope,
					),
				).rejects.toMatchObject({ code: "FORBIDDEN" });
			});
		}
	}

	for (const scope of [SALES_SCOPES.read, SALES_SCOPES.write]) {
		it(`denies a mismatched key owner for ${scope} despite a cookie`, async () => {
			verifyPermissions(
				{ crm: ["read"], sales: ["read", "proposal:write"] },
				"other",
			);
			await expect(
				salesActor(
					context({ [API_KEY_HEADER]: "fixture-key", cookie: "human-cookie" }),
					scope,
				),
			).rejects.toMatchObject({ code: "FORBIDDEN" });
		});
	}

	for (const resource of ["crm", "sales"]) {
		it(`denies proposal writes to ${resource} read keys`, async () => {
			verifyPermissions({ [resource]: ["read"] });
			await expect(
				salesActor(
					context({ [API_KEY_HEADER]: "fixture-key" }),
					SALES_SCOPES.write,
				),
			).rejects.toMatchObject({ code: "FORBIDDEN" });
		});
	}

	for (const scope of [
		SALES_SCOPES.read,
		SALES_SCOPES.write,
		SALES_SCOPES.approve,
	]) {
		it(`preserves human session identity for ${scope}`, async () => {
			const verify = verifyPermissions({});
			expect(
				await salesActor(context({ cookie: "human-cookie" }), scope),
			).toEqual({ kind: "session", userId: "human", sessionId: "session" });
			expect(verify).not.toHaveBeenCalled();
		});

		it(`denies missing authentication for ${scope}`, async () => {
			await expect(
				salesActor({ ...context({}), session: null }, scope),
			).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		});
	}

	for (const headers of [
		{ [API_KEY_HEADER]: "fixture-key" },
		{ authorization: "Bearer crm_fixture-key" },
		{
			[API_KEY_HEADER]: "fixture-key",
			authorization: "Bearer crm_fixture-key",
		},
	]) {
		for (const cookie of [false, true]) {
			it(`denies key approval for ${Object.keys(headers).join("+")} cookie=${cookie}`, async () => {
				const verify = verifyPermissions({
					sales: ["read", "proposal:write", "approve"],
				});
				await expect(
					salesActor(
						context(withCookie(headers, cookie)),
						SALES_SCOPES.approve,
					),
				).rejects.toMatchObject({ code: "FORBIDDEN" });
				expect(verify).not.toHaveBeenCalled();
			});
		}
	}
});

describe("sales creation response authorization", () => {
	for (const operation of ["storeProposal", "failRequest"] as const) {
		it(`denies write-only ${operation} before service response despite cookie`, async () => {
			verifyPermissions({ sales: ["proposal:write"] });
			const service = new SalesService({} as never);
			const call = spyOn(service, operation);
			await expect(
				new SalesRouter(service)[operation](
					context({ [API_KEY_HEADER]: "fixture-key", cookie: "human-cookie" }),
					{
						requestId: "00000000-0000-4000-8000-000000000001",
						operations: [],
					} as never,
				),
			).rejects.toMatchObject({ code: "FORBIDDEN" });
			expect(call).not.toHaveBeenCalled();
		});
	}
	const input = {
		source: "Synthetic note",
		candidateIds: ["contact"],
		expectedUpdatedAt: "2026-09-22T00:00:00.000Z",
		profileId: approvedSalesProfile.id,
		profileRevision: approvedSalesProfile.revision,
	};
	for (const [label, permissions] of [
		...deniedPermissions,
		["crm read only", { crm: ["read"] }],
		["sales read only", { sales: ["read"] }],
	] as [string, Permissions][]) {
		for (const mixed of [false, true]) {
			it(`denies createRequest before service and snapshot response: ${label}, cookie=${mixed}`, async () => {
				verifyPermissions(permissions);
				const service = new SalesService({} as never);
				const create = spyOn(service, "createRequest").mockRejectedValue(
					new Error("Unauthorized service call"),
				);
				let response: unknown;
				await expect(
					(async () => {
						response = await new SalesRouter(service).createRequest(
							context(withCookie({ [API_KEY_HEADER]: "fixture-key" }, mixed)),
							input,
						);
					})(),
				).rejects.toMatchObject({ code: "FORBIDDEN" });
				expect(create).not.toHaveBeenCalled();
				expect(response).toBeUndefined();
			});
		}
	}
	for (const resource of ["crm", "sales"]) {
		it(`passes independently verified ${resource} read and proposal-write to createRequest`, async () => {
			verifyPermissions(
				resource === "crm"
					? { crm: ["read"], sales: ["proposal:write"] }
					: { sales: ["read", "proposal:write"] },
			);
			const service = new SalesService({} as never);
			const create = spyOn(service, "createRequest").mockRejectedValue(
				new Error("Verified actor reached service"),
			);
			await expect(
				new SalesRouter(service).createRequest(
					context({ [API_KEY_HEADER]: "fixture-key", cookie: "human-cookie" }),
					input,
				),
			).rejects.toThrow("Verified actor reached service");
			expect(create).toHaveBeenCalledWith(
				{
					kind: "apiKey",
					userId: "human",
					keyId: "key-1",
					scopes: [SALES_SCOPES.write, SALES_SCOPES.read],
				},
				input,
			);
		});
	}
	for (const code of ["KEY_EXPIRED", "KEY_DISABLED", "KEY_NOT_FOUND"]) {
		it(`denies createRequest before service for ${code} with cookie`, async () => {
			mockVerify = spyOn(auth.api, "verifyApiKey").mockResolvedValue({
				valid: false,
				key: null,
				error: { code, message: code },
			} as never);
			const service = new SalesService({} as never);
			const create = spyOn(service, "createRequest");
			await expect(
				new SalesRouter(service).createRequest(
					context({ [API_KEY_HEADER]: "fixture-key", cookie: "human-cookie" }),
					input,
				),
			).rejects.toMatchObject({ code: "FORBIDDEN" });
			expect(create).not.toHaveBeenCalled();
		});
	}
});

describe("sales route authorization shared by REST tRPC and MCP", () => {
	it("rejects an unscoped key for proposal writes using explicit provider permission checks", async () => {
		mockVerify = spyOn(auth.api, "verifyApiKey").mockResolvedValue({
			valid: true,
			key: { id: "key-1", referenceId: "human", permissions: null },
			error: null,
		} as never);
		await expect(
			salesActor(
				context({ [API_KEY_HEADER]: "readonly-key" }),
				SALES_SCOPES.write,
			),
		).rejects.toThrow("denied");
		expect(mockVerify).toHaveBeenCalledWith({
			body: { key: "readonly-key" },
		});
	});
	it("accepts a verified write key but never treats it as a human", async () => {
		mockVerify = spyOn(auth.api, "verifyApiKey").mockResolvedValue({
			valid: true,
			key: {
				id: "key-1",
				referenceId: "human",
				permissions: { sales: ["proposal:write"] },
			},
			error: null,
		} as never);
		expect(
			await salesActor(
				context({ [API_KEY_HEADER]: "write-key" }),
				SALES_SCOPES.write,
			),
		).toEqual({
			kind: "apiKey",
			userId: "human",
			keyId: "key-1",
			scopes: [SALES_SCOPES.write],
		});
		await expect(
			salesActor(
				context({ [API_KEY_HEADER]: "write-key", cookie: "human-cookie" }),
				SALES_SCOPES.approve,
			),
		).rejects.toThrow("Human");
	});
	it("rejects bearer credentials for approval even with a cookie session", async () => {
		await expect(
			salesActor(
				context({ authorization: "Bearer crm_key", cookie: "human-cookie" }),
				SALES_SCOPES.approve,
			),
		).rejects.toThrow("Human");
	});
	it("preserves the authenticated human session identity", async () => {
		expect(
			await salesActor(
				context({ cookie: "human-cookie" }),
				SALES_SCOPES.approve,
			),
		).toEqual({ kind: "session", userId: "human", sessionId: "session" });
	});
	it("rejects a key belonging to a different session user", async () => {
		mockVerify = spyOn(auth.api, "verifyApiKey").mockResolvedValue({
			valid: true,
			key: {
				id: "key-1",
				referenceId: "other",
				permissions: { sales: ["proposal:write"] },
			},
			error: null,
		} as never);
		await expect(
			salesActor(
				context({ [API_KEY_HEADER]: "other-key" }),
				SALES_SCOPES.write,
			),
		).rejects.toThrow("denied");
	});
});
