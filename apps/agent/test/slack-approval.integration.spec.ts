import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import { readActionApproval } from "@crm/validation/agent-approval";
import {
	failRun,
	pendingAgentRunIds,
	settleSlackApprovals,
} from "../agent/lib/custom-agent-dispatch";
import { postRunSlackMessage } from "../agent/lib/run-runtime";

const suffix = crypto.randomUUID();
const userId = `slack-approval-user-${suffix}`;
const accountId = `slack-approval-account-${suffix}`;
const realFetch = globalThis.fetch;
const posts: string[] = [];

let approvalAgentId = "";
let approvalVersionId = "";
let openAgentId = "";
let openVersionId = "";

function slackManifest(requiresApproval: boolean) {
	const destination = {
		kind: "channel",
		resolution: "chosen",
		id: "C123",
		label: "#sales",
	};
	const post = requiresApproval
		? {
				type: "slack.message.post",
				provider: "slack",
				summary: "Post a message",
				destination,
				requiresApproval: true,
			}
		: {
				type: "slack.message.post",
				provider: "slack",
				summary: "Post a message",
				destination,
			};
	return {
		triggers: [
			{ type: "MANUAL", name: "Manual", summary: "Run by hand", config: {} },
		],
		dataScope: {
			mode: "WORKSPACE",
			summary: "Workspace",
			resources: [
				{ kind: "integration", id: "slack:workspace", label: "Slack" },
			],
		},
		actions: [post],
	};
}

async function createAgent(requiresApproval: boolean) {
	const agent = await db.agentDefinition.create({
		data: { name: "Slack approval", status: "LIVE", createdById: userId },
		select: { id: true },
	});
	const version = await db.agentVersion.create({
		data: {
			agentId: agent.id,
			number: 1,
			status: "DEPLOYED",
			instructions: "Post one message to Slack when asked.",
			manifest: slackManifest(requiresApproval),
			modelId: "test/model",
			sandboxPolicy: {},
			createdById: userId,
			approvedAt: new Date(),
			deployedAt: new Date(),
		},
		select: { id: true },
	});
	await db.agentDefinition.update({
		where: { id: agent.id },
		data: { currentVersionId: version.id },
	});
	return { agentId: agent.id, versionId: version.id };
}

async function createRun(
	agentId: string,
	versionId: string,
	startedAt = new Date(),
) {
	return db.agentRun.create({
		data: {
			agentId,
			versionId,
			triggerType: "MANUAL",
			status: "RUNNING",
			startedAt,
			sessionId: `slack-approval-session-${crypto.randomUUID()}`,
			idempotencyKey: `slack-approval-run-${crypto.randomUUID()}`,
			correlationId: crypto.randomUUID(),
			events: { create: { sequence: 0, type: "run.queued", data: {} } },
		},
		select: { id: true },
	});
}

async function decide(actionId: string, state: "APPROVED" | "REJECTED") {
	const action = await db.agentAction.findUniqueOrThrow({
		where: { id: actionId },
		select: { metadata: true },
	});
	const current = readActionApproval(action.metadata);
	if (!current) throw new Error("The action holds no approval request.");
	await db.agentAction.update({
		where: { id: actionId },
		data: {
			metadata: {
				...current,
				approval: {
					...current.approval,
					state,
					decidedById: userId,
					decidedAt: new Date().toISOString(),
				},
			},
		},
	});
}

beforeAll(async () => {
	await db.user.create({
		data: {
			id: userId,
			name: "Slack Approval Test",
			email: `${userId}@example.test`,
		},
	});
	await db.account.create({
		data: {
			id: accountId,
			accountId: `T-${suffix}`,
			providerId: "slack",
			userId,
			accessToken: "xoxb-approval-spec",
		},
	});
	const [approval, open] = await Promise.all([
		createAgent(true),
		createAgent(false),
	]);
	approvalAgentId = approval.agentId;
	approvalVersionId = approval.versionId;
	openAgentId = open.agentId;
	openVersionId = open.versionId;
});

afterEach(() => {
	globalThis.fetch = realFetch;
	posts.length = 0;
});

afterAll(async () => {
	const agentIds = [approvalAgentId, openAgentId];
	await db.agentRunEvent.deleteMany({
		where: { run: { agentId: { in: agentIds } } },
	});
	await db.agentAction.deleteMany({ where: { agentId: { in: agentIds } } });
	await db.agentAuditEvent.deleteMany({ where: { agentId: { in: agentIds } } });
	await db.agentRun.deleteMany({ where: { agentId: { in: agentIds } } });
	await db.agentDefinition.updateMany({
		where: { id: { in: agentIds } },
		data: { currentVersionId: null },
	});
	await db.agentVersion.deleteMany({ where: { agentId: { in: agentIds } } });
	await db.agentDefinition.deleteMany({ where: { id: { in: agentIds } } });
	await db.account.deleteMany({ where: { id: accountId } });
	await db.user.deleteMany({ where: { id: userId } });
});

function stubSlack() {
	globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
		posts.push(`${String(input)} ${String(init?.body)}`);
		return Response.json({ ok: true, channel: "C123", ts: "100.200" });
	}) as typeof fetch;
}

describe("Slack post approval", () => {
	it("posts at once when the manifest asks for no approval", async () => {
		stubSlack();
		const run = await createRun(openAgentId, openVersionId);

		const result = await postRunSlackMessage(run.id, "call-1", {
			text: "Deal closed",
		});

		expect(posts).toHaveLength(1);
		expect(result).toMatchObject({ messageId: "C123:100.200" });
		const row = await db.agentRun.findUniqueOrThrow({ where: { id: run.id } });
		expect(row.status).toBe("RUNNING");
	});

	it("waits for a person before any Slack call", async () => {
		stubSlack();
		const run = await createRun(approvalAgentId, approvalVersionId);

		const result = await postRunSlackMessage(run.id, "call-1", {
			text: "Deal closed",
		});

		expect(posts).toHaveLength(0);
		expect(result).toMatchObject({ awaitingApproval: true });
		const row = await db.agentRun.findUniqueOrThrow({
			where: { id: run.id },
			include: { actions: true },
		});
		expect(row.status).toBe("WAITING_FOR_APPROVAL");
		expect(row.actions).toHaveLength(1);
		expect(row.actions[0]?.status).toBe("PLANNED");
		expect(
			readActionApproval(row.actions[0]?.metadata ?? null)?.approval,
		).toMatchObject({
			state: "PENDING",
			text: "Deal closed",
		});
		expect(await settleSlackApprovals()).toBe(0);
		expect(posts).toHaveLength(0);
	});

	it("repeats the same request without a second action", async () => {
		const run = await createRun(approvalAgentId, approvalVersionId);

		await postRunSlackMessage(run.id, "call-1", { text: "Deal closed" });
		await postRunSlackMessage(run.id, "call-1", { text: "Deal closed" });

		expect(await db.agentAction.count({ where: { runId: run.id } })).toBe(1);
	});

	it("posts once after approval and completes the run", async () => {
		stubSlack();
		const run = await createRun(approvalAgentId, approvalVersionId);
		await postRunSlackMessage(run.id, "call-1", { text: "Deal closed" });
		const action = await db.agentAction.findFirstOrThrow({
			where: { runId: run.id },
		});
		await decide(action.id, "APPROVED");

		await Promise.all([settleSlackApprovals(), settleSlackApprovals()]);
		await settleSlackApprovals();

		expect(posts).toHaveLength(1);
		expect(posts[0]).toContain("Deal closed");
		const row = await db.agentRun.findUniqueOrThrow({
			where: { id: run.id },
			include: { actions: true },
		});
		expect(row.status).toBe("SUCCEEDED");
		expect(row.actions[0]).toMatchObject({
			status: "SUCCEEDED",
			externalId: "C123:100.200",
		});
	});

	it("does not time out a run that waited a long time for approval", async () => {
		const hourAgo = new Date(Date.now() - 60 * 60_000);
		const run = await createRun(approvalAgentId, approvalVersionId, hourAgo);
		await postRunSlackMessage(run.id, "call-1", { text: "Deal closed" });
		const action = await db.agentAction.findFirstOrThrow({
			where: { runId: run.id },
		});
		await decide(action.id, "APPROVED");
		globalThis.fetch = (async (
			input: URL | RequestInfo,
			init?: RequestInit,
		) => {
			posts.push(`${String(input)} ${String(init?.body)}`);
			await pendingAgentRunIds();
			return Response.json({ ok: true, channel: "C123", ts: "100.200" });
		}) as typeof fetch;

		await settleSlackApprovals();

		expect(posts).toHaveLength(1);
		const row = await db.agentRun.findUniqueOrThrow({ where: { id: run.id } });
		expect(row.status).toBe("SUCCEEDED");
	});

	it("keeps a pending approval when the session fails afterwards", async () => {
		stubSlack();
		const run = await createRun(approvalAgentId, approvalVersionId);
		await postRunSlackMessage(run.id, "call-1", { text: "Deal closed" });

		await failRun(run.id, "TURN_FAILED", "The model failed.");

		const waiting = await db.agentRun.findUniqueOrThrow({
			where: { id: run.id },
		});
		expect(waiting.status).toBe("WAITING_FOR_APPROVAL");
		expect(waiting.errorCode).toBeNull();
		const action = await db.agentAction.findFirstOrThrow({
			where: { runId: run.id },
		});
		await decide(action.id, "APPROVED");

		await settleSlackApprovals();

		expect(posts).toHaveLength(1);
		const done = await db.agentRun.findUniqueOrThrow({ where: { id: run.id } });
		expect(done.status).toBe("SUCCEEDED");
	});

	it("still fails a waiting run whose approval was already decided", async () => {
		const run = await createRun(approvalAgentId, approvalVersionId);
		await postRunSlackMessage(run.id, "call-1", { text: "Deal closed" });
		const action = await db.agentAction.findFirstOrThrow({
			where: { runId: run.id },
		});
		await decide(action.id, "APPROVED");

		await failRun(run.id, "TURN_FAILED", "The model failed.");

		const row = await db.agentRun.findUniqueOrThrow({ where: { id: run.id } });
		expect(row.status).toBe("FAILED");
	});

	it("sends nothing after rejection and ends the run as cancelled", async () => {
		stubSlack();
		const run = await createRun(approvalAgentId, approvalVersionId);
		await postRunSlackMessage(run.id, "call-1", { text: "Deal closed" });
		const action = await db.agentAction.findFirstOrThrow({
			where: { runId: run.id },
		});
		await decide(action.id, "REJECTED");

		await settleSlackApprovals();

		expect(posts).toHaveLength(0);
		const row = await db.agentRun.findUniqueOrThrow({
			where: { id: run.id },
			include: { actions: true },
		});
		expect(row).toMatchObject({
			status: "CANCELLED",
			errorCode: "APPROVAL_REJECTED",
		});
		expect(row.actions[0]?.status).toBe("CANCELLED");
	});

	it("fails the run when Slack refuses an approved post", async () => {
		globalThis.fetch = (async () =>
			Response.json({ ok: false, error: "channel_not_found" })) as typeof fetch;
		const run = await createRun(approvalAgentId, approvalVersionId);
		await postRunSlackMessage(run.id, "call-1", { text: "Deal closed" });
		const action = await db.agentAction.findFirstOrThrow({
			where: { runId: run.id },
		});
		await decide(action.id, "APPROVED");

		await settleSlackApprovals();

		const row = await db.agentRun.findUniqueOrThrow({ where: { id: run.id } });
		expect(row.status).toBe("FAILED");
		expect(row.errorMessage).toContain("channel_not_found");
	});
});
