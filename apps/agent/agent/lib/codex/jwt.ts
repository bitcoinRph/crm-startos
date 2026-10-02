import { z } from "zod";

const authClaims = z
	.object({
		chatgpt_account_id: z.string().min(1).optional(),
		chatgpt_plan_type: z.string().min(1).optional(),
	})
	.loose();

const tokenClaims = z
	.object({
		exp: z.number().int().optional(),
		email: z.string().optional(),
		"https://api.openai.com/profile": z
			.object({ email: z.string().optional() })
			.loose()
			.optional(),
		"https://api.openai.com/auth": authClaims.optional(),
	})
	.loose();

export type CodexIdentity = {
	accountId: string | null;
	email: string | null;
	planType: string | null;
	expiresAt: Date | null;
};

function claimsOf(token: string | null | undefined) {
	const payload = token?.split(".")[1];
	if (!payload) return null;
	try {
		const parsed = tokenClaims.safeParse(
			JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
		);
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

export function identityOf(
	accessToken: string,
	idToken: string | null,
): CodexIdentity {
	const access = claimsOf(accessToken);
	const id = claimsOf(idToken);
	const auth = {
		...id?.["https://api.openai.com/auth"],
		...access?.["https://api.openai.com/auth"],
	};
	return {
		accountId: auth.chatgpt_account_id ?? null,
		email:
			id?.email ??
			id?.["https://api.openai.com/profile"]?.email ??
			access?.["https://api.openai.com/profile"]?.email ??
			null,
		planType: auth.chatgpt_plan_type ?? null,
		expiresAt: access?.exp ? new Date(access.exp * 1000) : null,
	};
}
