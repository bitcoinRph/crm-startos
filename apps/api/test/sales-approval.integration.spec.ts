import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import { approvedSalesProfile } from "@crm/validation/sales";
import { type SalesActor, SalesService } from "../src/sales/sales.service";

const suffix = process.env.TEST_RUN_ID ?? "sales-approval-spec";
const userId = `user-sales-${suffix}`;
const sessionId = `session-sales-${suffix}`;
const contactId = `contact-sales-${suffix}`;
const source = "Head of Procurement. Send the revised quote. Prefers email.";
const operations = [
	{
		type: "contact_fact" as const,
		contactId,
		field: "jobTitle" as const,
		value: "Head of Procurement",
		evidence: "Head of Procurement",
	},
	{
		type: "create_task" as const,
		contactId,
		field: null,
		value: "Send the revised quote",
		evidence: "Send the revised quote",
	},
	{
		type: "create_note" as const,
		contactId,
		field: null,
		value: "Prefers email",
		evidence: "Prefers email",
	},
];

const human: SalesActor = { kind: "session", userId, sessionId };
const agentKey: SalesActor = {
	kind: "apiKey",
	userId,
	keyId: `key-sales-${suffix}`,
	scopes: ["sales:read", "sales:proposal:write"],
};

const service = new SalesService(db);
const created = { requestId: "", proposalId: "" };

async function cleanUp() {
	if (created.proposalId)
		await db.activity.deleteMany({
			where: {
				meta: { path: ["salesProposalId"], equals: created.proposalId },
			},
		});
	if (created.proposalId)
		await db.salesProposal.deleteMany({ where: { id: created.proposalId } });
	if (created.requestId)
		await db.salesRequest.deleteMany({ where: { id: created.requestId } });
	await db.contact.deleteMany({ where: { id: contactId } });
	await db.session.deleteMany({ where: { id: sessionId } });
	await db.user.deleteMany({ where: { id: userId } });
}

beforeAll(async () => {
	await cleanUp();
	await db.user.create({
		data: {
			id: userId,
			name: "Sales Approval Test",
			email: `${userId}@example.test`,
		},
	});
	await db.session.create({
		data: {
			id: sessionId,
			userId,
			token: `token-${suffix}`,
			expiresAt: new Date(Date.now() + 60 * 60 * 1000),
		},
	});
	await db.contact.create({
		data: { id: contactId, firstName: "Procurement", title: "Buyer" },
	});
});

afterAll(cleanUp);

describe("sales approval against a real database", () => {
	it("applies a proposal exactly once when two approvals race, and records who proposed it", async () => {
		const contact = await db.contact.findUniqueOrThrow({
			where: { id: contactId },
		});
		const request = await service.createRequest(human, {
			source,
			candidateIds: [contactId],
			expectedUpdatedAt: contact.updatedAt.toISOString(),
			profileId: approvedSalesProfile.id,
			profileRevision: approvedSalesProfile.revision,
		});
		created.requestId = request.id;

		const proposal = await service.storeProposal(agentKey, {
			requestId: request.id,
			operations,
			producedBy: "test/injected",
		});
		created.proposalId = proposal.id;
		expect(proposal.proposedByKeyId).toBe(agentKey.keyId);
		expect(proposal.producedBy).toBe("test/injected");

		const approval = {
			proposalId: proposal.id,
			idempotencyKey: proposal.idempotencyKey,
		};
		const [first, second] = await Promise.all([
			service.approveProposal(human, approval),
			service.approveProposal(human, approval),
		]);

		expect(first.approvedAt).not.toBeNull();
		expect(second.approvedAt?.getTime()).toBe(first.approvedAt?.getTime());
		expect(second.appliedActivityIds).toEqual(first.appliedActivityIds);

		const activities = await db.activity.findMany({
			where: { meta: { path: ["salesProposalId"], equals: proposal.id } },
			orderBy: { type: "asc" },
		});
		expect(activities.map((activity) => activity.type)).toEqual([
			"NOTE",
			"TASK",
		]);
		expect(
			activities.every((activity) => activity.contactId === contactId),
		).toBe(true);

		const updated = await db.contact.findUniqueOrThrow({
			where: { id: contactId },
		});
		expect(updated.title).toBe("Head of Procurement");

		const stored = await db.salesRequest.findUniqueOrThrow({
			where: { id: request.id },
		});
		expect(stored.status).toBe("APPROVED");
		expect(stored.requestedByKeyId).toBeNull();
	});
});
