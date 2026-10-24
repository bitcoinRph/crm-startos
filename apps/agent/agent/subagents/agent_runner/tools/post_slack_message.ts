import { defineTool } from "eve/tools";
import { z } from "zod";
import { postRunSlackMessage } from "../../../lib/run-runtime";
import { requireTeamAgentAttribute } from "../../../lib/session-purpose";

export default defineTool({
	description:
		"Post one message to the exact Slack channel or person approved in the deployed version. The destination comes from the manifest and the action is idempotent across retries. When the version asks for approval, the post waits for a person and the result says so.",
	inputSchema: z.object({
		text: z.string().trim().min(1).max(4_000),
	}),
	async execute(input, ctx) {
		return postRunSlackMessage(
			requireTeamAgentAttribute(ctx, "runId"),
			ctx.callId,
			input,
			ctx.abortSignal,
		);
	},
});
