import { describe, expect, it } from "bun:test";
import { parseAgentManifest } from "../src/agent-manifest";

const manifest = (extra: { requiresApproval?: boolean }) => ({
	actions: [
		{
			type: "slack.message.post",
			provider: "slack",
			summary: "Post a message",
			destination: {
				kind: "channel",
				resolution: "chosen",
				id: "C123",
				label: "#sales",
			},
			...extra,
		},
	],
	triggers: [
		{ type: "MANUAL", name: "Manual", summary: "By hand", config: {} },
	],
	dataScope: { mode: "WORKSPACE", summary: "Workspace", resources: [] },
});

describe("Slack action approval flag", () => {
	it("defaults to no approval", () => {
		const [action] = parseAgentManifest(manifest({})).actions;
		expect(action).toMatchObject({ requiresApproval: false });
	});

	it("keeps an explicit request for approval", () => {
		const [action] = parseAgentManifest(
			manifest({ requiresApproval: true }),
		).actions;
		expect(action).toMatchObject({ requiresApproval: true });
	});
});
