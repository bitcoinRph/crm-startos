import type {
	LanguageModelV4Content,
	LanguageModelV4GenerateResult,
	LanguageModelV4Reasoning,
	LanguageModelV4ResponseMetadata,
	LanguageModelV4StreamPart,
	LanguageModelV4StreamResult,
	LanguageModelV4Text,
	SharedV4Warning,
} from "@ai-sdk/provider";

type Finish = Extract<LanguageModelV4StreamPart, { type: "finish" }>;

export async function generateFromStream(
	result: LanguageModelV4StreamResult,
): Promise<LanguageModelV4GenerateResult> {
	const content: LanguageModelV4Content[] = [];
	const open = new Map<
		string,
		LanguageModelV4Text | LanguageModelV4Reasoning
	>();
	let warnings: SharedV4Warning[] = [];
	let metadata: LanguageModelV4ResponseMetadata = {};
	let finish: Finish | null = null;
	const reader = result.stream.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		switch (value.type) {
			case "stream-start":
				warnings = value.warnings;
				break;
			case "text-start":
			case "reasoning-start": {
				const part: LanguageModelV4Text | LanguageModelV4Reasoning = {
					type: value.type === "text-start" ? "text" : "reasoning",
					text: "",
					providerMetadata: value.providerMetadata,
				};
				open.set(`${value.type}:${value.id}`, part);
				content.push(part);
				break;
			}
			case "text-delta":
			case "reasoning-delta": {
				const kind =
					value.type === "text-delta" ? "text-start" : "reasoning-start";
				const part = open.get(`${kind}:${value.id}`);
				if (part) part.text += value.delta;
				break;
			}
			case "text-end":
			case "reasoning-end": {
				const kind =
					value.type === "text-end" ? "text-start" : "reasoning-start";
				const part = open.get(`${kind}:${value.id}`);
				if (part && value.providerMetadata)
					part.providerMetadata = value.providerMetadata;
				break;
			}
			case "tool-call":
			case "tool-result":
			case "tool-approval-request":
			case "custom":
			case "file":
			case "reasoning-file":
			case "source":
				content.push(value);
				break;
			case "response-metadata":
				metadata = {
					id: value.id,
					timestamp: value.timestamp,
					modelId: value.modelId,
				};
				break;
			case "finish":
				finish = value;
				break;
			case "error":
				throw value.error;
			default:
				break;
		}
	}
	if (!finish)
		throw new Error("CODEX_STREAM_INCOMPLETE: The response ended early.");
	return {
		content,
		finishReason: finish.finishReason,
		usage: finish.usage,
		providerMetadata: finish.providerMetadata,
		request: result.request,
		response: { ...metadata, headers: result.response?.headers },
		warnings,
	};
}
