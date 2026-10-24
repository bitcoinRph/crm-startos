import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import { approvedSalesProfile } from "@crm/validation/sales";
import { type SalesActor, SalesService } from "../src/sales/sales.service";

const suffix = process.env.TEST_RUN_ID ?? "sales-rejection-spec";
const userId = `user-reject-${suffix}`;
const sessionId = `session-reject-${suffix}`;
const contactId = `contact-reject-${suffix}`;
const source = "Head of Procurement. Prefers email.";
const operations = [
	{
		type: "contact_fact" as const,
		contactId,
		field: "jobTitle" as const,
		value: "Head of Procurement",
		evidence: "Head of Procurement",
	},
];

const human: SalesActor = { kind: "session", userId, sessionId };
const agentKey: SalesActor = {
	kind: "apiKey",
	userId,
	keyId: `key-reject-${suffix}`,
	scopes: ["sales:read", "sales:proposal:write"],
};

const service = new SalesService(db);
const requestIds: string[] = [];

async function cleanUp() {
	await db.activity.deleteMany({ where: { contactId } });
	await db.salesProposal.deleteMany({
		where: { request: { contactId } },
	});
	await db.salesRequest.deleteMany({ where: { contactId } });
	await db.contact.deleteMany({ where: { id: contactId } });
	await db.session.deleteMany({ where: { id: sessionId } });
	await db.user.deleteMany({ where: { id: userId } });
}

async function newRequest() {
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
	requestIds.push(request.id);
	return request;
}

async function newProposal() {
	const request = await newRequest();
	return service.storeProposal(agentKey, {
		requestId: request.id,
		operations,
		producedBy: "test/injected",
	});
}

beforeAll(async () => {
	await cleanUp();
	await db.user.create({
		data: {
			id: userId,
			name: "Sales Rejection Test",
			email: `${userId}@example.test`,
		},
	});
	await db.session.create({
		data: {
			id: sessionId,
			userId,
			token: `token-reject-${suffix}`,
			expiresAt: new Date(Date.now() + 60 * 60 * 1000),
		},
	});
	await db.contact.create({
		data: { id: contactId, firstName: "Procurement", title: "Buyer" },
	});
});

afterAll(cleanUp);

describe("the sales review queue", () => {
	it("lists proposals that wait on a person before requests that wait on an agent", async () => {
		const pending = await newRequest();
		const proposal = await newProposal();

		const queue = await service.reviewQueue(agentKey, 100);
		const ours = queue.rows.filter((row) => row.contactId === contactId);

		expect(ours.map((row) => row.id)).toEqual([proposal.requestId, pending.id]);
		expect(ours[0]?.proposal?.id).toBe(proposal.id);
		expect(queue.counts.pending).toBeGreaterThanOrEqual(1);
		expect(queue.counts.proposed).toBeGreaterThanOrEqual(1);
	});

	it("needs sales read permission", async () => {
		await expect(
			service.reviewQueue({ ...agentKey, scopes: [] }, 10),
		).rejects.toThrow("Missing scope: sales:read");
	});
});

describe("rejecting a sales proposal", () => {
	it("refuses an API key, because only a person decides", async () => {
		const proposal = await newProposal();
		await expect(
			service.rejectProposal(agentKey, {
				proposalId: proposal.id,
				idempotencyKey: proposal.idempotencyKey,
				reason: "Wrong person",
			}),
		).rejects.toThrow("Human session required.");
	});

	it("records who rejected it and why, changes no record, and answers a repeat the same way", async () => {
		const proposal = await newProposal();
		const before = await db.contact.findUniqueOrThrow({
			where: { id: contactId },
		});
		const rejection = {
			proposalId: proposal.id,
			idempotencyKey: proposal.idempotencyKey,
			reason: "  The note is about a different Dana.  ",
		};

		const first = await service.rejectProposal(human, rejection);
		const second = await service.rejectProposal(human, rejection);

		expect(first.rejectedAt).not.toBeNull();
		expect(first.rejectedById).toBe(userId);
		expect(first.rejectedSessionId).toBe(sessionId);
		expect(first.rejectionReason).toBe("The note is about a different Dana.");
		expect(second.rejectedAt?.getTime()).toBe(first.rejectedAt?.getTime());

		const request = await db.salesRequest.findUniqueOrThrow({
			where: { id: proposal.requestId },
		});
		expect(request.status).toBe("REJECTED");

		const after = await db.contact.findUniqueOrThrow({
			where: { id: contactId },
		});
		expect(after.title).toBe(before.title);
		expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
		expect(await db.activity.count({ where: { contactId } })).toBe(0);

		const queue = await service.reviewQueue(human, 100);
		expect(queue.rows.some((row) => row.id === proposal.requestId)).toBe(false);
	});

	it("leaves a rejected proposal and its request unchangeable in the database", async () => {
		const proposal = await newProposal();
		await service.rejectProposal(human, {
			proposalId: proposal.id,
			idempotencyKey: proposal.idempotencyKey,
			reason: "Duplicate note",
		});
		await expect(
			(async () =>
				db.salesProposal.update({
					where: { id: proposal.id },
					data: { rejectionReason: "Edited later" },
				}))(),
		).rejects.toThrow("immutable");
		await expect(
			(async () =>
				db.salesRequest.update({
					where: { id: proposal.requestId },
					data: { status: "PROPOSED" },
				}))(),
		).rejects.toThrow("Decided request is immutable");
	});

	it("will not approve a rejected proposal", async () => {
		const proposal = await newProposal();
		await service.rejectProposal(human, {
			proposalId: proposal.id,
			idempotencyKey: proposal.idempotencyKey,
			reason: "Not this one",
		});
		await expect(
			service.approveProposal(human, {
				proposalId: proposal.id,
				idempotencyKey: proposal.idempotencyKey,
			}),
		).rejects.toThrow("This proposal was rejected.");
	});

	it("will not reject an approved proposal", async () => {
		const proposal = await newProposal();
		await service.approveProposal(human, {
			proposalId: proposal.id,
			idempotencyKey: proposal.idempotencyKey,
		});
		await expect(
			service.rejectProposal(human, {
				proposalId: proposal.id,
				idempotencyKey: proposal.idempotencyKey,
				reason: "Too late",
			}),
		).rejects.toThrow("This proposal was already approved.");
	});

	it("needs a reason", async () => {
		const proposal = await newProposal();
		await expect(
			service.rejectProposal(human, {
				proposalId: proposal.id,
				idempotencyKey: proposal.idempotencyKey,
				reason: "   ",
			}),
		).rejects.toThrow();
	});
});
