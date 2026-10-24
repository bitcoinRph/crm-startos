import type { Prisma } from "@crm/db";
import { BRAND } from "@crm/env/brand";
import { parse, schemas } from "@crm/validation";
import { joinSlackChannel } from "./slack-membership";

export async function runSlackChannelJoin(
	value: Prisma.JsonValue,
): Promise<string> {
	const { channelId, channelName } = parse(
		schemas.slack.joinPayload,
		value,
		"A slack-channel-join task carries an unreadable payload",
	);
	const outcome = await joinSlackChannel(channelId);

	if (outcome.joined) {
		return outcome.already
			? `${BRAND.slackApp} was already in #${channelName}.`
			: `${BRAND.slackApp} joined #${channelName}.`;
	}

	return `${BRAND.slackApp} could not join #${channelName}. ${outcome.reason}`;
}
