import {
	CODEX_UNAVAILABLE_STATUS,
	type CodexBridgeRequest,
	type CodexDeviceStart,
	type CodexModelList,
	type CodexPollOutcome,
	type CodexStatus,
	codexDeviceStart,
	codexFailure,
	codexModelList,
	codexPollOutcome,
	codexStatus,
} from "@crm/validation/codex";
import { Injectable, Logger } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import type { z } from "zod";
import { bridge } from "../agent/bridge";
import { CODEX_BRIDGE } from "./codex.config";

type Step = keyof typeof CODEX_BRIDGE.timeoutMs;

@Injectable()
export class CodexService {
	private readonly logger = new Logger(CodexService.name);

	private async ask<T>(
		step: Step,
		path: string,
		body: CodexBridgeRequest,
		schema: z.ZodType<T>,
	): Promise<T> {
		const agent = bridge();
		if (!agent)
			throw new TRPCError({
				code: "PRECONDITION_FAILED",
				message: "This install has no AGENT_BRIDGE_SECRET, so Codex is off.",
			});
		let response: Response;
		try {
			response = await fetch(agent.url(`/internal/crm/codex/${path}`), {
				method: "POST",
				headers: {
					authorization: `Bearer ${agent.secret}`,
					"content-type": "application/json",
				},
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(CODEX_BRIDGE.timeoutMs[step]),
			});
		} catch (error) {
			this.logger.warn({
				message: "The agent did not answer a Codex request",
				step,
				reason: error instanceof Error ? error.name : "unknown",
			});
			throw new TRPCError({
				code: "SERVICE_UNAVAILABLE",
				message: "The agent did not answer. Try again in a moment.",
			});
		}
		const payload: unknown = await response.json().catch(() => null);
		if (response.status === 422) {
			const failure = codexFailure.safeParse(payload);
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: failure.success ? failure.data.error : "Codex refused that.",
			});
		}
		if (!response.ok) {
			this.logger.warn({
				message: "The agent refused a Codex request",
				step,
				status: response.status,
			});
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: `The agent answered ${response.status}.`,
			});
		}
		return schema.parse(payload);
	}

	async status(userId: string): Promise<CodexStatus> {
		if (!bridge()) return CODEX_UNAVAILABLE_STATUS;
		return this.ask("status", "status", { userId }, codexStatus);
	}

	startSignIn(userId: string): Promise<CodexDeviceStart> {
		return this.ask("signIn", "device/start", { userId }, codexDeviceStart);
	}

	async pollSignIn(userId: string): Promise<CodexPollOutcome> {
		const outcome = await this.ask(
			"signIn",
			"device/poll",
			{ userId },
			codexPollOutcome,
		);
		if (outcome.state === "connected")
			this.logger.log({ message: "Codex connected", userId, kind: "CHATGPT" });
		return outcome;
	}

	async connectApiKey(userId: string, apiKey: string): Promise<CodexStatus> {
		const status = await this.ask(
			"apiKey",
			"api-key",
			{ userId, apiKey },
			codexStatus,
		);
		this.logger.log({ message: "Codex connected", userId, kind: "API_KEY" });
		return status;
	}

	models(userId: string): Promise<CodexModelList> {
		return this.ask("models", "models", { userId }, codexModelList);
	}

	async setModel(
		userId: string,
		modelId: string | null,
		contextWindowTokens: number | null,
	): Promise<CodexStatus> {
		const status = await this.ask(
			"model",
			"model",
			{ userId, modelId, contextWindowTokens },
			codexStatus,
		);
		this.logger.log({ message: "Codex model changed", userId, modelId });
		return status;
	}

	async disconnect(userId: string): Promise<CodexStatus> {
		const status = await this.ask(
			"disconnect",
			"disconnect",
			{ userId },
			codexStatus,
		);
		this.logger.log({ message: "Codex disconnected", userId });
		return status;
	}
}
