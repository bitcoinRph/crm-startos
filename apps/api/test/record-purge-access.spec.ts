import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { DEFAULT_WORKSPACE_NAME, WORKSPACE_ID } from "@crm/auth";
import { db } from "@crm/db";
import { workspaceSlug } from "@crm/db/workspace";
import { AgentAccessService } from "../src/agent/agent-access.service";
import { CompaniesRouter } from "../src/companies/companies.router";
import type { CompaniesService } from "../src/companies/companies.service";
import { ContactsRouter } from "../src/contacts/contacts.router";
import type { ContactsService } from "../src/contacts/contacts.service";
import { DealsRouter } from "../src/deals/deals.router";
import type { DealsService } from "../src/deals/deals.service";
import type { AuthedTrpcContext } from "../src/trpc/context.types";

const suffix = crypto.randomUUID();
const ownerId = `purge-owner-${suffix}`;
const adminId = `purge-admin-${suffix}`;
const memberId = `purge-member-${suffix}`;
const strangerId = `purge-stranger-${suffix}`;
const roles = [
	[ownerId, "owner"],
	[adminId, "admin"],
	[memberId, "member"],
] as const;

const purged: string[] = [];
const service = {
	purge: async (id: string) => {
		purged.push(id);
		return { id, name: id };
	},
	bulkPurge: async (ids: string[]) => {
		purged.push(...ids);
		return {
			requested: ids.length,
			succeeded: ids.length,
			skipped: 0,
			failed: 0,
			message: null,
		};
	},
};

const access = new AgentAccessService(db);
const routers = {
	companies: new CompaniesRouter(
		service as unknown as CompaniesService,
		access,
	),
	contacts: new ContactsRouter(service as unknown as ContactsService, access),
	deals: new DealsRouter(service as unknown as DealsService, access),
};

function ctxOf(id: string) {
	return { user: { id } } as unknown as AuthedTrpcContext;
}

beforeAll(async () => {
	await db.organization.upsert({
		where: { id: WORKSPACE_ID },
		update: {},
		create: {
			id: WORKSPACE_ID,
			name: DEFAULT_WORKSPACE_NAME,
			slug: workspaceSlug(DEFAULT_WORKSPACE_NAME),
			createdAt: new Date(),
		},
	});
	await db.user.createMany({
		data: [...roles.map(([id]) => id), strangerId].map((id) => ({
			id,
			name: id,
			email: `${id}@example.test`,
		})),
	});
	await db.member.createMany({
		data: roles.map(([userId, role]) => ({
			id: `m-${userId}`,
			organizationId: WORKSPACE_ID,
			userId,
			role,
			createdAt: new Date(),
		})),
	});
});

afterAll(async () => {
	await db.member.deleteMany({
		where: { id: { in: roles.map(([userId]) => `m-${userId}`) } },
	});
	await db.user.deleteMany({
		where: { id: { in: [...roles.map(([id]) => id), strangerId] } },
	});
});

describe("who can purge records", () => {
	for (const [name, router] of Object.entries(routers)) {
		it(`refuses a member on ${name}, single and bulk`, async () => {
			purged.length = 0;
			await expect(router.purge(ctxOf(memberId), "r1")).rejects.toMatchObject({
				status: 403,
				message: expect.stringMatching(/owner or an admin/),
			});
			await expect(
				router.bulkPurge(ctxOf(memberId), ["r1", "r2"]),
			).rejects.toMatchObject({ status: 403 });
			expect(purged).toEqual([]);
		});

		it(`refuses a user who is not in the workspace on ${name}`, async () => {
			purged.length = 0;
			await expect(router.purge(ctxOf(strangerId), "r1")).rejects.toMatchObject(
				{ status: 403 },
			);
			expect(purged).toEqual([]);
		});

		it(`lets an owner and an admin purge on ${name}`, async () => {
			purged.length = 0;
			await router.purge(ctxOf(ownerId), "r1");
			await router.bulkPurge(ctxOf(adminId), ["r2", "r3"]);
			expect(purged).toEqual(["r1", "r2", "r3"]);
		});
	}
});
