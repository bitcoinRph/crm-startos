import type { LanguageModelV4 } from "@ai-sdk/provider";
import { db } from "@crm/db";
import { type CodexKind, createCodexModel } from "./model";
import type { CodexFetch } from "./oauth";

export type CodexBinding = {
	userId: string;
	modelId: string;
	kind: CodexKind;
	contextWindowTokens: number;
};

type Principal = {
	readonly principalId: string;
	readonly principalType: string;
} | null;

type AuthContext = {
	readonly session: {
		readonly auth: {
			readonly current: Principal;
			readonly initiator: Principal;
		};
	};
};

export function humanCaller(
	ctx: AuthContext,
	which: "current" | "initiator",
): string | null {
	const principal = ctx.session.auth[which];
	return principal?.principalType === "user" ? principal.principalId : null;
}

export async function codexBindingFor(
	userId: string,
): Promise<CodexBinding | null> {
	const row = await db.codexConnection.findUnique({
		where: { userId },
		select: {
			status: true,
			kind: true,
			modelId: true,
			modelContextWindowTokens: true,
		},
	});
	if (row?.status !== "ACTIVE" || !row.modelId || !row.modelContextWindowTokens)
		return null;
	return {
		userId,
		modelId: row.modelId,
		kind: row.kind,
		contextWindowTokens: row.modelContextWindowTokens,
	};
}

export function codexSelection(
	binding: CodexBinding,
	callerId: string | null,
	refused: () => { model: LanguageModelV4; modelContextWindowTokens: number },
	transport: CodexFetch = fetch,
) {
	if (callerId !== binding.userId) return refused();
	return {
		model: createCodexModel(
			binding.userId,
			binding.modelId,
			binding.kind,
			transport,
		),
		modelContextWindowTokens: binding.contextWindowTokens,
	};
}
