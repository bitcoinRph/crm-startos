import { z } from "zod";
import { CODEX } from "./config";

export type CodexFetch = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;

export class CodexAuthError extends Error {
	constructor(
		readonly kind: "reconnect" | "transient" | "rejected",
		message: string,
	) {
		super(message);
		this.name = "CodexAuthError";
	}
}

const userCodeResponse = z
	.object({
		device_auth_id: z.string().min(1),
		user_code: z.string().min(1).optional(),
		usercode: z.string().min(1).optional(),
		interval: z.union([z.string(), z.number()]).optional(),
	})
	.loose();

const pollResponse = z
	.object({
		authorization_code: z.string().min(1),
		code_verifier: z.string().min(1),
	})
	.loose();

const exchangedTokens = z
	.object({
		id_token: z.string().min(1),
		access_token: z.string().min(1),
		refresh_token: z.string().min(1),
	})
	.loose();

const refreshedTokens = z
	.object({
		id_token: z.string().min(1).optional(),
		access_token: z.string().min(1),
		refresh_token: z.string().min(1).optional(),
	})
	.loose();

const errorBody = z
	.object({
		error: z
			.union([
				z.string(),
				z
					.looseObject({ code: z.string().optional() })
					.transform((error) => error.code),
			])
			.optional(),
		code: z.string().optional(),
	})
	.loose();

export type DeviceCode = {
	deviceAuthId: string;
	userCode: string;
	intervalSeconds: number;
	verificationUrl: string;
};

export type CodexTokens = {
	idToken: string | null;
	accessToken: string;
	refreshToken: string;
};

const url = (path: string) => `${CODEX.auth.issuer}${path}`;

function interval(value: string | number | undefined): number {
	const parsed = Number.parseInt(String(value ?? ""), 10);
	return Math.max(
		CODEX.auth.minIntervalSeconds,
		Number.isFinite(parsed) ? parsed : CODEX.auth.defaultIntervalSeconds,
	);
}

function headers(contentType: string): Headers {
	return new Headers({
		"Content-Type": contentType,
		Accept: "application/json",
		originator: CODEX.backend.originator,
		"User-Agent": CODEX.backend.userAgent,
	});
}

async function errorCode(response: Response): Promise<string | null> {
	const parsed = errorBody.safeParse(await response.json().catch(() => null));
	if (!parsed.success) return null;
	return parsed.data.error ?? parsed.data.code ?? null;
}

export async function requestDeviceCode(
	transport: CodexFetch,
): Promise<DeviceCode> {
	const response = await transport(url(CODEX.auth.userCodePath), {
		method: "POST",
		headers: headers("application/json"),
		body: JSON.stringify({ client_id: CODEX.auth.clientId }),
		redirect: "error",
		signal: AbortSignal.timeout(CODEX.auth.requestTimeoutMs),
	});
	if (response.status === 404)
		throw new CodexAuthError(
			"rejected",
			"Device code sign-in is not enabled for this ChatGPT account. Turn on device code login in ChatGPT security settings, or use an API key.",
		);
	if (!response.ok)
		throw new CodexAuthError(
			"transient",
			`OpenAI answered ${response.status} to the sign-in request.`,
		);
	const body = userCodeResponse.parse(await response.json());
	const userCode = body.user_code ?? body.usercode;
	if (!userCode)
		throw new CodexAuthError("transient", "OpenAI sent no sign-in code.");
	return {
		deviceAuthId: body.device_auth_id,
		userCode,
		intervalSeconds: interval(body.interval),
		verificationUrl: url(CODEX.auth.verificationPath),
	};
}

export async function pollDeviceCode(
	transport: CodexFetch,
	device: { deviceAuthId: string; userCode: string },
): Promise<CodexTokens | null> {
	const response = await transport(url(CODEX.auth.pollPath), {
		method: "POST",
		headers: headers("application/json"),
		body: JSON.stringify({
			device_auth_id: device.deviceAuthId,
			user_code: device.userCode,
		}),
		redirect: "error",
		signal: AbortSignal.timeout(CODEX.auth.requestTimeoutMs),
	});
	if (response.status === 403 || response.status === 404) return null;
	if (!response.ok)
		throw new CodexAuthError(
			"rejected",
			`OpenAI answered ${response.status} while waiting for sign-in.`,
		);
	const code = pollResponse.parse(await response.json());
	return exchangeCode(transport, code.authorization_code, code.code_verifier);
}

async function exchangeCode(
	transport: CodexFetch,
	code: string,
	verifier: string,
): Promise<CodexTokens> {
	const response = await transport(url(CODEX.auth.tokenPath), {
		method: "POST",
		headers: headers("application/x-www-form-urlencoded"),
		body: new URLSearchParams({
			grant_type: "authorization_code",
			code,
			redirect_uri: url(CODEX.auth.callbackPath),
			client_id: CODEX.auth.clientId,
			code_verifier: verifier,
		}).toString(),
		redirect: "error",
		signal: AbortSignal.timeout(CODEX.auth.requestTimeoutMs),
	});
	if (!response.ok)
		throw new CodexAuthError(
			"rejected",
			`OpenAI answered ${response.status} to the token exchange.`,
		);
	const tokens = exchangedTokens.parse(await response.json());
	return {
		idToken: tokens.id_token,
		accessToken: tokens.access_token,
		refreshToken: tokens.refresh_token,
	};
}

export async function refreshCodexTokens(
	transport: CodexFetch,
	current: CodexTokens,
): Promise<CodexTokens> {
	let response: Response;
	try {
		response = await transport(url(CODEX.auth.tokenPath), {
			method: "POST",
			headers: headers("application/json"),
			body: JSON.stringify({
				client_id: CODEX.auth.clientId,
				grant_type: "refresh_token",
				refresh_token: current.refreshToken,
			}),
			redirect: "error",
			signal: AbortSignal.timeout(CODEX.auth.refreshTimeoutMs),
		});
	} catch (error) {
		throw new CodexAuthError(
			"transient",
			`The token refresh did not reach OpenAI: ${error instanceof Error ? error.name : "error"}.`,
		);
	}
	if (!response.ok) {
		const code = await errorCode(response);
		const reconnect =
			(response.status === 400 || response.status === 401) &&
			code !== null &&
			CODEX.auth.reconnectErrors.some((known) => known === code);
		throw new CodexAuthError(
			reconnect ? "reconnect" : "transient",
			reconnect
				? `OpenAI ended this sign-in (${code}). Connect ChatGPT again.`
				: `OpenAI answered ${response.status} to the token refresh.`,
		);
	}
	const tokens = refreshedTokens.parse(await response.json());
	return {
		idToken: tokens.id_token ?? current.idToken,
		accessToken: tokens.access_token,
		refreshToken: tokens.refresh_token ?? current.refreshToken,
	};
}

export async function revokeCodexTokens(
	transport: CodexFetch,
	tokens: CodexTokens,
): Promise<boolean> {
	try {
		const response = await transport(url(CODEX.auth.revokePath), {
			method: "POST",
			headers: headers("application/json"),
			body: JSON.stringify({
				token: tokens.refreshToken,
				token_type_hint: "refresh_token",
				client_id: CODEX.auth.clientId,
			}),
			redirect: "error",
			signal: AbortSignal.timeout(CODEX.auth.requestTimeoutMs),
		});
		return response.ok;
	} catch {
		return false;
	}
}
