import type { Prisma } from "@crm/db";
import { z } from "zod";

export const AGENT_APPROVAL_STATES = {
	PENDING: "PENDING",
	APPROVED: "APPROVED",
	REJECTED: "REJECTED",
} as const;

export const AGENT_APPROVAL_DECISIONS = ["APPROVE", "REJECT"] as const;

export const AGENT_APPROVAL_REJECTED_CODE = "APPROVAL_REJECTED";

export const agentApprovalDecision = z.enum(AGENT_APPROVAL_DECISIONS);

export type AgentApprovalDecision = z.infer<typeof agentApprovalDecision>;

export const agentActionApproval = z.object({
	state: z.enum(AGENT_APPROVAL_STATES),
	text: z.string(),
	decidedById: z.string().nullable(),
	decidedAt: z.string().nullable(),
});

export const agentApprovalMetadata = z.object({
	clientMessageId: z.string().min(1),
	approval: agentActionApproval,
});

export type AgentApprovalMetadata = z.infer<typeof agentApprovalMetadata>;

export function readActionApproval(
	metadata: Prisma.JsonValue,
): AgentApprovalMetadata | null {
	const parsed = agentApprovalMetadata.safeParse(metadata);
	return parsed.success ? parsed.data : null;
}
