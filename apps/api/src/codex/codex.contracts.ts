import {
	codexApiKey,
	codexContextWindow,
	codexDeviceStart,
	codexModelId,
	codexModelList,
	codexPollOutcome,
	codexStatus,
} from "@crm/validation/codex";
import { z } from "zod";

export const codexStatusOutput = codexStatus;
export const codexSignInOutput = codexDeviceStart;
export const codexPollOutput = codexPollOutcome;
export const codexModelsOutput = codexModelList;

export const codexConnectApiKeyInput = z.strictObject({ apiKey: codexApiKey });

export const codexSetModelInput = z.strictObject({
	modelId: codexModelId.nullable(),
	contextWindowTokens: codexContextWindow.nullable(),
});
