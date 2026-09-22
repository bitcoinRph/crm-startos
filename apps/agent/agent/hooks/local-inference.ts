import { defineHook } from "eve/hooks";
import { initializeInferenceSession } from "../lib/model";

export default defineHook({
	events: {
		"session.started": () => {
			initializeInferenceSession();
		},
	},
});
