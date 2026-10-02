import { db } from "@crm/db";
import { maskKey } from "@crm/db/settings";
import {
	CODEX_UNAVAILABLE_STATUS,
	type CodexDeviceStart,
	type CodexPollOutcome,
	type CodexStatus,
} from "@crm/validation/codex";
import { z } from "zod";
import { CODEX } from "./config";
import { identityOf } from "./jwt";
import {
	CodexAuthError,
	type CodexFetch,
	type CodexTokens,
	pollDeviceCode,
	refreshCodexTokens,
	requestDeviceCode,
	revokeCodexTokens,
} from "./oauth";
import { seal, sealingAvailable, unseal } from "./seal";

const chatgptSecret = z.strictObject({
	kind: z.literal("CHATGPT"),
	idToken: z.string().nullable(),
	accessToken: z.string().min(1),
	refreshToken: z.string().min(1),
});

const apiKeySecret = z.strictObject({
	kind: z.literal("API_KEY"),
	apiKey: z.string().min(1),
});

const connectionSecret = z.discriminatedUnion("kind", [
	chatgptSecret,
	apiKeySecret,
]);

const deviceSecret = z.strictObject({
	deviceAuthId: z.string().min(1),
	userCode: z.string().min(1),
});

type ConnectionSecret = z.infer<typeof connectionSecret>;

export type CodexCredential =
	| { kind: "CHATGPT"; accessToken: string; accountId: string }
	| { kind: "API_KEY"; apiKey: string };

export class CodexUnavailableError extends Error {
	constructor(message: string) {
		super(`CODEX_UNAVAILABLE: ${message}`);
		this.name = "CodexUnavailableError";
	}
}

const connectionContext = (userId: string) => `codex-connection:${userId}`;
const deviceContext = (userId: string) => `codex-device:${userId}`;

function readSecret(userId: string, sealed: string): ConnectionSecret {
	return connectionSecret.parse(
		JSON.parse(unseal(sealed, connectionContext(userId))),
	);
}

function sealSecret(userId: string, secret: ConnectionSecret): string {
	return seal(
		JSON.stringify(connectionSecret.parse(secret)),
		connectionContext(userId),
	);
}

export async function codexStatus(userId: string): Promise<CodexStatus> {
	const available = sealingAvailable();
	const row = await db.codexConnection.findUnique({
		where: { userId },
		select: {
			kind: true,
			status: true,
			label: true,
			planType: true,
			modelId: true,
			modelContextWindowTokens: true,
			connectedAt: true,
			lastError: true,
		},
	});
	if (!row) return { ...CODEX_UNAVAILABLE_STATUS, available };
	return {
		available,
		connected: true,
		kind: row.kind,
		state: row.status,
		label: row.label,
		planType: row.planType,
		modelId: row.modelId,
		modelContextWindowTokens: row.modelContextWindowTokens,
		connectedAt: row.connectedAt.toISOString(),
		lastError: row.lastError,
	};
}

type Resolution =
	| { ok: true; credential: CodexCredential }
	| { ok: false; error: string };

function credentialFor(secret: ConnectionSecret): Resolution {
	if (secret.kind === "API_KEY")
		return { ok: true, credential: { kind: "API_KEY", apiKey: secret.apiKey } };
	const { accountId } = identityOf(secret.accessToken, secret.idToken);
	if (!accountId)
		return { ok: false, error: "The ChatGPT sign-in carries no account id." };
	return {
		ok: true,
		credential: {
			kind: "CHATGPT",
			accessToken: secret.accessToken,
			accountId,
		},
	};
}

export async function resolveCodexCredential(
	userId: string,
	transport: CodexFetch = fetch,
	staleAccessToken?: string,
): Promise<CodexCredential> {
	if (!sealingAvailable())
		throw new CodexUnavailableError("CRM_SECRETS_KEY is not set.");
	const resolution = await db.$transaction(
		async (tx): Promise<Resolution> => {
			await tx.$queryRaw`SELECT "userId" FROM "codexConnection" WHERE "userId" = ${userId} FOR UPDATE`;
			const row = await tx.codexConnection.findUnique({ where: { userId } });
			if (!row) return { ok: false, error: "Codex is not connected." };
			if (row.status !== "ACTIVE")
				return {
					ok: false,
					error: row.lastError ?? "Connect Codex again in Settings.",
				};
			const secret = readSecret(userId, row.sealed);
			if (secret.kind === "API_KEY") return credentialFor(secret);
			const { expiresAt } = identityOf(secret.accessToken, secret.idToken);
			const expiring =
				!expiresAt ||
				expiresAt.getTime() - Date.now() <= CODEX.auth.refreshSkewMs;
			const forced =
				staleAccessToken !== undefined &&
				staleAccessToken === secret.accessToken;
			if (!expiring && !forced) return credentialFor(secret);
			let next: CodexTokens;
			try {
				next = await refreshCodexTokens(transport, secret);
			} catch (error) {
				if (error instanceof CodexAuthError && error.kind === "reconnect") {
					await tx.codexConnection.update({
						where: { userId },
						data: { status: "NEEDS_RECONNECT", lastError: error.message },
					});
					return { ok: false, error: error.message };
				}
				return {
					ok: false,
					error: error instanceof Error ? error.message : "The refresh failed.",
				};
			}
			const refreshed: ConnectionSecret = { kind: "CHATGPT", ...next };
			const identity = identityOf(next.accessToken, next.idToken);
			await tx.codexConnection.update({
				where: { userId },
				data: {
					sealed: sealSecret(userId, refreshed),
					accessExpiresAt: identity.expiresAt,
					planType: identity.planType ?? row.planType,
					refreshedAt: new Date(),
					lastError: null,
				},
			});
			return credentialFor(refreshed);
		},
		{ timeout: CODEX.auth.lockTimeoutMs, maxWait: CODEX.auth.lockTimeoutMs },
	);
	if (!resolution.ok) throw new CodexUnavailableError(resolution.error);
	return resolution.credential;
}

export async function startDeviceLogin(
	userId: string,
	transport: CodexFetch = fetch,
): Promise<CodexDeviceStart> {
	if (!sealingAvailable())
		throw new CodexUnavailableError("CRM_SECRETS_KEY is not set.");
	const device = await requestDeviceCode(transport);
	const expiresAt = new Date(Date.now() + CODEX.auth.deviceLifetimeMs);
	const sealed = seal(
		JSON.stringify(
			deviceSecret.parse({
				deviceAuthId: device.deviceAuthId,
				userCode: device.userCode,
			}),
		),
		deviceContext(userId),
	);
	await db.codexDeviceLogin.upsert({
		where: { userId },
		create: {
			userId,
			sealed,
			interval: device.intervalSeconds,
			expiresAt,
		},
		update: { sealed, interval: device.intervalSeconds, expiresAt },
	});
	return {
		verificationUrl: device.verificationUrl,
		userCode: device.userCode,
		expiresAt: expiresAt.toISOString(),
		intervalSeconds: device.intervalSeconds,
	};
}

async function replaceConnection(
	userId: string,
	secret: ConnectionSecret,
	label: string,
	planType: string | null,
	accessExpiresAt: Date | null,
	transport: CodexFetch,
) {
	const previous = await db.codexConnection.findUnique({
		where: { userId },
		select: { kind: true, sealed: true },
	});
	const keepModel = previous?.kind === secret.kind;
	const sealed = sealSecret(userId, secret);
	const update = {
		kind: secret.kind,
		status: "ACTIVE" as const,
		sealed,
		label,
		planType,
		accessExpiresAt,
		lastError: null,
		connectedAt: new Date(),
		refreshedAt: null,
	};
	await db.codexConnection.upsert({
		where: { userId },
		create: {
			userId,
			kind: secret.kind,
			sealed,
			label,
			planType,
			accessExpiresAt,
		},
		update: keepModel
			? update
			: { ...update, modelId: null, modelContextWindowTokens: null },
	});
	if (previous) await revokeSealed(userId, previous.sealed, transport);
}

async function revokeSealed(
	userId: string,
	sealed: string,
	transport: CodexFetch,
) {
	try {
		const secret = readSecret(userId, sealed);
		if (secret.kind === "CHATGPT") await revokeCodexTokens(transport, secret);
	} catch {
		return;
	}
}

export async function pollDeviceLogin(
	userId: string,
	transport: CodexFetch = fetch,
): Promise<CodexPollOutcome> {
	const login = await db.codexDeviceLogin.findUnique({ where: { userId } });
	if (!login)
		return { state: "failed", reason: "No ChatGPT sign-in is in progress." };
	if (login.expiresAt.getTime() <= Date.now()) {
		await db.codexDeviceLogin.deleteMany({ where: { userId } });
		return { state: "expired" };
	}
	const device = deviceSecret.parse(
		JSON.parse(unseal(login.sealed, deviceContext(userId))),
	);
	let tokens: CodexTokens | null;
	try {
		tokens = await pollDeviceCode(transport, device);
	} catch (error) {
		await db.codexDeviceLogin.deleteMany({ where: { userId } });
		return {
			state: "failed",
			reason: error instanceof Error ? error.message : "Sign-in failed.",
		};
	}
	if (!tokens) return { state: "pending" };
	const identity = identityOf(tokens.accessToken, tokens.idToken);
	await db.codexDeviceLogin.deleteMany({ where: { userId } });
	if (!identity.accountId) {
		await revokeCodexTokens(transport, tokens);
		return {
			state: "failed",
			reason: "The ChatGPT sign-in carries no account id.",
		};
	}
	await replaceConnection(
		userId,
		{ kind: "CHATGPT", ...tokens },
		identity.email ?? "ChatGPT account",
		identity.planType,
		identity.expiresAt,
		transport,
	);
	return { state: "connected", status: await codexStatus(userId) };
}

export async function connectApiKey(
	userId: string,
	apiKey: string,
	transport: CodexFetch = fetch,
): Promise<CodexStatus> {
	if (!sealingAvailable())
		throw new CodexUnavailableError("CRM_SECRETS_KEY is not set.");
	let response: Response;
	try {
		response = await transport(
			`${CODEX.platform.baseURL}${CODEX.platform.modelsPath}`,
			{
				method: "GET",
				headers: new Headers({ Authorization: `Bearer ${apiKey}` }),
				redirect: "error",
				signal: AbortSignal.timeout(CODEX.platform.modelListTimeoutMs),
			},
		);
	} catch {
		throw new CodexUnavailableError(
			"OpenAI could not be reached to check the key.",
		);
	}
	if (response.status === 401 || response.status === 403)
		throw new CodexUnavailableError("OpenAI did not accept that API key.");
	if (!response.ok)
		throw new CodexUnavailableError(
			`OpenAI answered ${response.status} while checking the key.`,
		);
	await replaceConnection(
		userId,
		{ kind: "API_KEY", apiKey },
		`OpenAI API key ${maskKey(apiKey)}`,
		null,
		null,
		transport,
	);
	return codexStatus(userId);
}

export async function disconnectCodex(
	userId: string,
	transport: CodexFetch = fetch,
): Promise<CodexStatus> {
	await db.codexDeviceLogin.deleteMany({ where: { userId } });
	const row = await db.codexConnection.findUnique({
		where: { userId },
		select: { sealed: true },
	});
	if (row) {
		await db.codexConnection.deleteMany({ where: { userId } });
		await revokeSealed(userId, row.sealed, transport);
	}
	return codexStatus(userId);
}

export async function chooseCodexModel(
	userId: string,
	model: { id: string; contextWindowTokens: number } | null,
): Promise<CodexStatus> {
	await db.codexConnection.update({
		where: { userId },
		data: {
			modelId: model?.id ?? null,
			modelContextWindowTokens: model?.contextWindowTokens ?? null,
		},
	});
	return codexStatus(userId);
}
