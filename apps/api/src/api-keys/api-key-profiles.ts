import { z } from "zod";

export const API_KEY_PROFILES = [
	"crm_integration",
	"agent_propose",
	"agent_read",
] as const;

export type ApiKeyProfile = (typeof API_KEY_PROFILES)[number];

export const apiKeyProfile = z.enum(API_KEY_PROFILES);

export const apiKeyPermissions = z.record(z.string(), z.array(z.string()));

export type ApiKeyPermissions = z.infer<typeof apiKeyPermissions>;

export const KEY_PERMISSIONS = {
	crm_integration: { crm: ["read", "write"] },
	agent_propose: { crm: ["read"], sales: ["read", "proposal:write"] },
	agent_read: { crm: ["read"] },
} satisfies Record<ApiKeyProfile, ApiKeyPermissions>;

function canonical(permissions: ApiKeyPermissions): string {
	return JSON.stringify(
		Object.keys(permissions)
			.sort()
			.map((resource) => [resource, [...(permissions[resource] ?? [])].sort()]),
	);
}

export function parseStoredPermissions(
	value: string | null | undefined,
): ApiKeyPermissions | null {
	if (!value) return null;
	return apiKeyPermissions.parse(JSON.parse(value));
}

export function profileOf(
	permissions: ApiKeyPermissions | null,
): ApiKeyProfile | null {
	if (!permissions) return null;
	const wanted = canonical(permissions);
	return (
		API_KEY_PROFILES.find(
			(profile) => canonical(KEY_PERMISSIONS[profile]) === wanted,
		) ?? null
	);
}

export function permits(
	permissions: ApiKeyPermissions,
	resource: string,
	action: string,
): boolean {
	return permissions[resource]?.includes(action) ?? false;
}
