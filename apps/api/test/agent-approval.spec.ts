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
import {
	API_KEY_HEADER,
	auth,
	DEFAULT_WORKSPACE_NAME,
	WORKSPACE_ID,
} from "@crm/auth";
import type { Db } from "@crm/db";
import { db } from "@crm/db";
import { workspaceSlug } from "@crm/db/workspace";
import { readActionApproval } from "@crm/validation/agent-approval";
import type { MiddlewareOptions } from "nestjs-trpc";
import { AgentAccessService } from "../src/agent/agent-access.service";
import { AgentRunsService } from "../src/agent/agent-runs.service";
import type { AgentTriggerService } from "../src/agent/agent-trigger.service";
import { ApiKeyAuditService } from "../src/api-keys/api-key-audit.service";
import { AuthMiddleware } from "../src/trpc/middlewares/auth.middleware";

const audit = new ApiKeyAuditService({} as Db);
spyOn(audit, "record").mockImplementation(() => undefined);

const suffix = crypto.randomUUID();
const ownerId = `agent-approval-owner-${suffix}`;
const bystanderId = `agent-approval-bystander-${suffix}`;
const outsiderId = `agent-approval-outsider-${suffix}`;
const memberIds = [
	`agent-approval-m1-${suffix}`,
	`agent-approval-m2-${suffix}`,
];
let agentId = "";
let pokes = 0;
const trigger = {
	deployedAgentRunQueued() {
		pokes += 1;
	},
} as AgentTriggerService;
const service = new AgentRunsService(db, new AgentAccessService(db), trigger);

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
		data: [ownerId, bystanderId, outsiderId].map((id) => ({
			id,
			name: id,
			email: `${id}@example.test`,
		})),
	});
	await db.member.createMany({
		data: [
			{
				id: memberIds[0] ?? "",
				userId: ownerId,
				role: "member",
				organizationId: WORKSPACE_ID,
				createdAt: new Date(),
			},
			{
				id: memberIds[1] ?? "",
				userId: bystanderId,
				role: "member",
				organizationId: WORKSPACE_ID,
				createdAt: new Date(),
			},
		],
	});
	const agent = await db.agentDefinition.create({
		data: { name: "Approve safely", status: "LIVE", createdById: ownerId },
		select: { id: true },
	});
	agentId = agent.id;
	const version = await db.agentVersion.create({
		data: {
			agentId,
			number: 1,
			status: "DEPLOYED",
			instructions: "Post once.",
			manifest: {},
			modelId: "test/model",
			sandboxPolicy: {},
			createdById: ownerId,
		},
		select: { id: true },
	});
	await db.agentDefinition.update({
		where: { id: agentId },
		data: { currentVersionId: version.id },
	});
});

afterEach(async () => {
	pokes = 0;
	await db.agentRunEvent.deleteMany({ where: { run: { agentId } } });
	await db.agentAction.deleteMany({ where: { agentId } });
	await db.agentAuditEvent.deleteMany({ where: { agentId } });
	await db.agentRun.deleteMany({ where: { agentId } });
});

afterAll(async () => {
	await db.agentDefinition.updateMany({
		where: { id: agentId },
		data: { currentVersionId: null },
	});
	await db.agentVersion.deleteMany({ where: { agentId } });
	await db.agentDefinition.deleteMany({ where: { id: agentId } });
	await db.member.deleteMany({ where: { id: { in: memberIds } } });
	await db.user.deleteMany({
		where: { id: { in: [ownerId, bystanderId, outsiderId] } },
	});
});

async function waitingRun(
	status: "WAITING_FOR_APPROVAL" | "RUNNING" = "WAITING_FOR_APPROVAL",
) {
	const run = await db.agentRun.create({
		data: {
			agentId,
			versionId: (
				await db.agentVersion.findFirstOrThrow({ where: { agentId } })
			).id,
			triggerType: "MANUAL",
			status,
			initiatedById: ownerId,
			startedAt: new Date(),
			idempotencyKey: `approval-run-${crypto.randomUUID()}`,
			correlationId: crypto.randomUUID(),
		},
		select: { id: true },
	});
	const action = await db.agentAction.create({
		data: {
			agentId,
			runId: run.id,
			type: "slack.message.post",
			provider: "slack",
			targetLabel: "#sales",
			summary: "Post a message to #sales",
			status: "PLANNED",
			idempotencyKey: `${run.id}:call`,
			requestHash: "hash",
			metadata: {
				clientMessageId: crypto.randomUUID(),
				approval: {
					state: "PENDING",
					text: "Deal closed",
					decidedById: null,
					decidedAt: null,
				},
			},
		},
		select: { id: true },
	});
	return { runId: run.id, actionId: action.id };
}

describe("deciding a Slack approval", () => {
	it("shows the waiting post to the person who may decide it", async () => {
		const { runId, actionId } = await waitingRun();

		const history = await service.list(agentId, 50, ownerId);

		expect(history.find((run) => run.id === runId)?.pendingApproval).toEqual({
			actionId,
			destination: "#sales",
			text: "Deal closed",
			canDecide: true,
		});
	});

	it("shows no pending post on a run that is not waiting", async () => {
		const { runId } = await waitingRun("RUNNING");

		const history = await service.list(agentId, 50, ownerId);

		expect(history.find((run) => run.id === runId)?.pendingApproval).toBeNull();
	});

	it("records an approval for the agent to pick up and pokes it", async () => {
		const { runId, actionId } = await waitingRun();

		const result = await service.decideApproval(
			{ id: agentId, runId, decision: "APPROVE" },
			ownerId,
		);

		expect(result).toEqual({ id: runId, decision: "APPROVE" });
		const [run, action] = await Promise.all([
			db.agentRun.findUniqueOrThrow({ where: { id: runId } }),
			db.agentAction.findUniqueOrThrow({ where: { id: actionId } }),
		]);
		expect(run.status).toBe("WAITING_FOR_APPROVAL");
		expect(action.status).toBe("PLANNED");
		expect(readActionApproval(action.metadata)?.approval).toMatchObject({
			state: "APPROVED",
			text: "Deal closed",
			decidedById: ownerId,
		});
		expect(pokes).toBe(1);
		expect(
			await db.agentAuditEvent.count({
				where: { agentId, requestId: runId, type: "run.approval.approved" },
			}),
		).toBe(1);
	});

	it("records a rejection", async () => {
		const { runId, actionId } = await waitingRun();

		await service.decideApproval(
			{ id: agentId, runId, decision: "REJECT" },
			ownerId,
		);

		const action = await db.agentAction.findUniqueOrThrow({
			where: { id: actionId },
		});
		expect(readActionApproval(action.metadata)?.approval.state).toBe(
			"REJECTED",
		);
	});

	it("repeats the same decision without a second audit entry", async () => {
		const { runId } = await waitingRun();
		const input = { id: agentId, runId, decision: "APPROVE" as const };

		await service.decideApproval(input, ownerId);
		await service.decideApproval(input, ownerId);

		expect(
			await db.agentAuditEvent.count({
				where: { agentId, requestId: runId },
			}),
		).toBe(1);
	});

	it("refuses to change a decision already recorded", async () => {
		const { runId } = await waitingRun();
		await service.decideApproval(
			{ id: agentId, runId, decision: "APPROVE" },
			ownerId,
		);

		await expect(
			service.decideApproval(
				{ id: agentId, runId, decision: "REJECT" },
				ownerId,
			),
		).rejects.toThrow("already been decided");
	});

	it("refuses a run that is not waiting", async () => {
		const { runId } = await waitingRun("RUNNING");

		await expect(
			service.decideApproval(
				{ id: agentId, runId, decision: "APPROVE" },
				ownerId,
			),
		).rejects.toThrow("not waiting for approval");
	});

	it("refuses a member who neither started the run nor manages the agent", async () => {
		const { runId } = await waitingRun();

		await expect(
			service.decideApproval(
				{ id: agentId, runId, decision: "APPROVE" },
				bystanderId,
			),
		).rejects.toThrow("Only the person who started this run");
	});

	it("refuses a caller outside the workspace", async () => {
		const { runId } = await waitingRun();

		await expect(
			service.decideApproval(
				{ id: agentId, runId, decision: "APPROVE" },
				outsiderId,
			),
		).rejects.toThrow("not a member");
	});
});

describe("approval is a human decision", () => {
	let verify:
		| ReturnType<typeof spyOn<typeof auth.api, "verifyApiKey">>
		| undefined;

	afterEach(() => {
		verify?.mockRestore();
		verify = undefined;
	});

	function request(headers: Record<string, string>) {
		const next = mock(async () => ({ ok: true, data: null }));
		const opts = {
			ctx: {
				req: { headers },
				session: { user: { id: "human" }, session: { id: "session" } },
			},
			path: "agents.decideRunApproval",
			type: "mutation",
			next,
		} as unknown as MiddlewareOptions;
		return { opts, next };
	}

	function keyWith(permissions: Record<string, string[]> | null) {
		verify = spyOn(auth.api, "verifyApiKey").mockResolvedValue({
			valid: true,
			key: { id: "key-1", referenceId: "human", permissions },
			error: null,
		} as never);
	}

	it("denies every API key profile", async () => {
		const profiles: Array<Record<string, string[]> | null> = [
			null,
			{ crm: ["read", "write"] },
			{ crm: ["read"], sales: ["read", "proposal:write"] },
		];
		for (const permissions of profiles) {
			keyWith(permissions);
			const { opts, next } = request({ [API_KEY_HEADER]: "crm_fixture" });
			await expect(new AuthMiddleware(audit).use(opts)).rejects.toMatchObject({
				code: "FORBIDDEN",
			});
			expect(next).not.toHaveBeenCalled();
			verify?.mockRestore();
		}
	});

	it("allows a human session", async () => {
		const { opts, next } = request({ cookie: "human-cookie" });

		await new AuthMiddleware(audit).use(opts);

		expect(next).toHaveBeenCalledTimes(1);
	});
});
