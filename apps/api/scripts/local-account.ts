import { isWorkspaceEmail } from "@crm/auth/workspace";
import { db } from "@crm/db";
import { hashPassword } from "better-auth/crypto";

const CREDENTIAL_PROVIDER = "credential";

const email = process.env.LOCAL_ACCOUNT_EMAIL?.trim().toLowerCase();
const password = process.env.LOCAL_ACCOUNT_PASSWORD;
const name =
	process.env.LOCAL_ACCOUNT_NAME?.trim() || email?.split("@")[0] || "Admin";

if (!email || !password) {
	throw new Error(
		"LOCAL_ACCOUNT_EMAIL and LOCAL_ACCOUNT_PASSWORD are required.",
	);
}

if (password.length < 8) {
	throw new Error("LOCAL_ACCOUNT_PASSWORD must be at least 8 characters.");
}

if (!isWorkspaceEmail(email)) {
	throw new Error(
		`${email} is not on the ALLOWED_SIGN_IN list, so it cannot have an account.`,
	);
}

const hash = await hashPassword(password);
const now = new Date();

const user = await db.user.upsert({
	where: { email },
	create: {
		id: crypto.randomUUID(),
		email,
		name,
		emailVerified: true,
		createdAt: now,
		updatedAt: now,
	},
	update: {},
	select: { id: true },
});

const credential = await db.account.findFirst({
	where: { userId: user.id, providerId: CREDENTIAL_PROVIDER },
	select: { id: true },
});

if (credential) {
	await db.account.update({
		where: { id: credential.id },
		data: { password: hash, updatedAt: now },
	});
} else {
	await db.account.create({
		data: {
			id: crypto.randomUUID(),
			accountId: user.id,
			providerId: CREDENTIAL_PROVIDER,
			userId: user.id,
			password: hash,
			createdAt: now,
			updatedAt: now,
		},
	});
}

console.log(`local account ready for ${email}`);

await db.$disconnect();
