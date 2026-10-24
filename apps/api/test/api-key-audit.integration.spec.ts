import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	mock,
	spyOn,
} from "bun:test";
import { auth } from "@crm/auth";
import { type Db, db } from "@crm/db";
import { Logger } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import type { MiddlewareOptions } from "nestjs-trpc";
import { ApiKeyAuditService } from "../src/api-keys/api-key-audit.service";
import { AuthMiddleware } from "../src/trpc/middlewares/auth.middleware";

const suffix = process.env.TEST_RUN_ID ?? "api-key-audit-spec";
const userId = `user-audit-${suffix}`;
const otherUserId = `user-audit-other-${suffix}`;
const keyId = `key-audit-${suffix}`;
const otherKeyId = `key-audit-other-${suffix}`;
const marker = `MARKER-${crypto.randomUUID()}`;

const audit = new ApiKeyAuditService(db);
const middleware = new AuthMiddleware(audit);

let verify:
	| ReturnType<typeof spyOn<typeof auth.api, "verifyApiKey">>
	| undefined;

async function seedKey(id: string, owner: string) {
	await db.apikey.create({
		data: {
			id,
			referenceId: owner,
			key: `hash-${id}`,
			createdAt: new Date(),
			updatedAt: new Date(),
		},
	});
}

async function wipe() {
	await db.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
}

beforeAll(async () => {
	await wipe();
	for (const id of [userId, otherUserId]) {
		await db.user.create({
			data: { id, name: id, email: `${id}@example.test` },
		});
	}
	await seedKey(keyId, userId);
	await seedKey(otherKeyId, otherUserId);
});

afterEach(async () => {
	verify?.mockRestore();
	verify = undefined;
	await db.apiKeyCall.deleteMany({
		where: { keyId: { in: [keyId, otherKeyId] } },
	});
});

afterAll(wipe);

function provide(permissions: Record<string, string[]> | null) {
	verify = spyOn(auth.api, "verifyApiKey").mockResolvedValue({
		valid: true,
		key: { id: keyId, referenceId: userId, permissions },
		error: null,
	} as never);
}

type StubResult = { ok: true; data: null } | { ok: false; error: TRPCError };

function request(
	path: string,
	type: "query" | "mutation",
	next = mock(async (): Promise<StubResult> => ({ ok: true, data: null })),
) {
	return {
		next,
		opts: {
			ctx: {
				req: { headers: { "x-api-key": "crm_fixture", cookie: marker } },
				session: { user: { id: userId }, session: { id: "session" } },
			},
			path,
			type,
			input: { note: marker },
			getRawInput: async () => ({ note: marker }),
			next,
		} as unknown as MiddlewareOptions,
	};
}

async function rows(id = keyId) {
	return db.apiKeyCall.findMany({
		where: { keyId: id },
		orderBy: { createdAt: "asc" },
	});
}

async function settled(count: number, id = keyId) {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		const found = await rows(id);
		if (found.length >= count) return found;
		await Bun.sleep(20);
	}
	return rows(id);
}

describe("API key call audit", () => {
	it("writes one allowed row for a permitted call", async () => {
		provide({ crm: ["read", "write"] });
		const { opts } = request("contacts.list", "query");
		await middleware.use(opts);
		const found = await settled(1);
		expect(found).toHaveLength(1);
		expect(found[0]).toMatchObject({
			keyId,
			procedure: "contacts.list",
			type: "query",
			outcome: "allowed",
		});
	});

	it("writes one denied row for a refused call", async () => {
		provide({ crm: ["read"] });
		const { opts, next } = request("contacts.update", "mutation");
		await expect(middleware.use(opts)).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
		expect(next).not.toHaveBeenCalled();
		const found = await settled(1);
		expect(found).toHaveLength(1);
		expect(found[0]).toMatchObject({
			keyId,
			procedure: "contacts.update",
			type: "mutation",
			outcome: "denied",
		});
	});

	it("records a sales call from the outcome of the procedure", async () => {
		provide({ crm: ["read"], sales: ["read"] });
		await middleware.use(request("sales.pendingRequests", "query").opts);
		const refused = request(
			"sales.storeProposal",
			"mutation",
			mock(
				async (): Promise<StubResult> => ({
					ok: false,
					error: new TRPCError({ code: "FORBIDDEN" }),
				}),
			),
		);
		await middleware.use(refused.opts);
		const found = await settled(2);
		expect(found.map((row) => [row.procedure, row.outcome])).toEqual([
			["sales.pendingRequests", "allowed"],
			["sales.storeProposal", "denied"],
		]);
	});

	it("writes nothing for a browser session", async () => {
		const { opts } = request("contacts.list", "query");
		const bare = {
			...opts,
			ctx: { session: { user: { id: userId }, session: { id: "s" } } },
		} as unknown as MiddlewareOptions;
		await middleware.use(bare);
		await Bun.sleep(100);
		expect(await rows()).toHaveLength(0);
	});

	it("still serves the call when the write fails", async () => {
		provide({ crm: ["read", "write"] });
		const warn = spyOn(Logger.prototype, "warn").mockImplementation(
			() => undefined,
		);
		try {
			const { opts, next } = request("contacts.list", "query");
			await expect(
				new AuthMiddleware(new ApiKeyAuditService({} as Db)).use(opts),
			).resolves.toEqual({ ok: true, data: null });
			expect(next).toHaveBeenCalledTimes(1);
			for (let attempt = 0; attempt < 50 && warn.mock.calls.length === 0; ) {
				await Bun.sleep(20);
				attempt += 1;
			}
			expect(warn).toHaveBeenCalledTimes(1);
			expect(warn.mock.calls[0]?.[0]).toMatchObject({
				message: "API key call not recorded",
				apiKeyId: keyId,
				procedure: "contacts.list",
			});
		} finally {
			warn.mockRestore();
		}
	});

	it("stores no argument text in any column", async () => {
		provide({ crm: ["read", "write"] });
		await middleware.use(request("contacts.update", "mutation").opts);
		await settled(1);
		const dump = await db.$queryRaw<Array<{ row: string }>>`
			SELECT row_to_json(t)::text AS row FROM "apiKeyCall" t WHERE t."keyId" = ${keyId}
		`;
		expect(dump).toHaveLength(1);
		expect(dump[0]?.row).not.toContain(marker);
		expect(dump[0]?.row).not.toContain("MARKER");
	});
});

describe("API key call list", () => {
	it("returns the newest 50 calls for the caller's own key", async () => {
		const base = Date.now() - 10 * 60_000;
		await db.apiKeyCall.createMany({
			data: Array.from({ length: 60 }, (_, index) => ({
				keyId,
				procedure: `contacts.call${index}`,
				type: "query",
				outcome: "allowed" as const,
				createdAt: new Date(base + index * 1000),
			})),
		});
		await db.apiKeyCall.create({
			data: {
				keyId: otherKeyId,
				procedure: "deals.list",
				type: "query",
				outcome: "denied",
			},
		});

		const own = await audit.recent(userId, keyId);
		expect(own).toHaveLength(50);
		expect(own[0]?.procedure).toBe("contacts.call59");
		expect(own[49]?.procedure).toBe("contacts.call10");
		expect(Object.keys(own[0] ?? {}).sort()).toEqual([
			"createdAt",
			"outcome",
			"procedure",
			"type",
		]);

		expect(await audit.recent(userId, otherKeyId)).toEqual([]);
		expect(await audit.recent(otherUserId, keyId)).toEqual([]);
	});
});

describe("API key call retention", () => {
	it("removes rows older than the cutoff and keeps newer ones", async () => {
		const now = Date.now();
		const day = 24 * 60 * 60_000;
		await db.apiKeyCall.createMany({
			data: [
				{
					keyId,
					procedure: "old.one",
					type: "query",
					outcome: "allowed",
					createdAt: new Date(now - 200 * day),
				},
				{
					keyId,
					procedure: "old.two",
					type: "query",
					outcome: "denied",
					createdAt: new Date(now - 181 * day),
				},
				{
					keyId,
					procedure: "new.one",
					type: "query",
					outcome: "allowed",
					createdAt: new Date(now - 179 * day),
				},
				{
					keyId: otherKeyId,
					procedure: "new.two",
					type: "query",
					outcome: "allowed",
					createdAt: new Date(now),
				},
			],
		});

		const removed = await audit.purgeExpired(new Date(now - 180 * day));

		expect(removed).toBeGreaterThanOrEqual(2);
		expect((await rows()).map((row) => row.procedure)).toEqual(["new.one"]);
		expect((await rows(otherKeyId)).map((row) => row.procedure)).toEqual([
			"new.two",
		]);
	});

	it("cascades with the key", async () => {
		await db.apiKeyCall.create({
			data: { keyId, procedure: "a.b", type: "query", outcome: "allowed" },
		});
		await db.apikey.delete({ where: { id: keyId } });
		expect(await rows()).toHaveLength(0);
		await seedKey(keyId, userId);
	});
});
