import { defineHook } from "eve/hooks";
import { initializeInferenceSession } from "../lib/model";

export default defineHook({
	events: {
		"session.started": (_event, ctx) =>
			initializeInferenceSession(ctx, !ctx.session.parent),
	},
});
