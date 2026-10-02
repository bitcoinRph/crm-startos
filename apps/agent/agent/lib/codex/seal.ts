import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { CODEX } from "./config";

function secretsKey(): Buffer | null {
	const raw = process.env.CRM_SECRETS_KEY?.trim();
	if (!raw || !/^[0-9a-fA-F]+$/.test(raw)) return null;
	const key = Buffer.from(raw, "hex");
	return key.length === CODEX.sealing.keyBytes ? key : null;
}

export function sealingAvailable(): boolean {
	return secretsKey() !== null;
}

function requireKey(): Buffer {
	const key = secretsKey();
	if (!key) throw new Error("CODEX_SEALING_UNAVAILABLE");
	return key;
}

export function seal(plaintext: string, context: string): string {
	const iv = randomBytes(CODEX.sealing.ivBytes);
	const cipher = createCipheriv("aes-256-gcm", requireKey(), iv);
	cipher.setAAD(Buffer.from(context));
	const body = Buffer.concat([
		cipher.update(plaintext, "utf8"),
		cipher.final(),
	]);
	return [
		CODEX.sealing.version,
		iv.toString("base64url"),
		cipher.getAuthTag().toString("base64url"),
		body.toString("base64url"),
	].join(".");
}

export function unseal(sealed: string, context: string): string {
	const [version, iv, tag, body] = sealed.split(".");
	if (version !== CODEX.sealing.version || !iv || !tag || !body)
		throw new Error("CODEX_SEALED_VALUE_UNREADABLE");
	const decipher = createDecipheriv(
		"aes-256-gcm",
		requireKey(),
		Buffer.from(iv, "base64url"),
	);
	decipher.setAAD(Buffer.from(context));
	decipher.setAuthTag(Buffer.from(tag, "base64url"));
	return Buffer.concat([
		decipher.update(Buffer.from(body, "base64url")),
		decipher.final(),
	]).toString("utf8");
}
