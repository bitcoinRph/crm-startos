export const API_KEY_PROFILE_OPTIONS = [
	{
		value: "crm_integration",
		label: "CRM integration",
		description:
			"Reads and changes companies, contacts, deals, notes and tasks. Everything you can do.",
	},
	{
		value: "agent_propose",
		label: "Agent: read and propose",
		description:
			"Reads the CRM and files proposals for your review. Changes no record on its own.",
	},
	{
		value: "agent_read",
		label: "Agent: read only",
		description: "Reads the CRM. Changes nothing.",
	},
] as const;

export type ApiKeyProfileValue =
	(typeof API_KEY_PROFILE_OPTIONS)[number]["value"];

export const DEFAULT_API_KEY_PROFILE: ApiKeyProfileValue = "crm_integration";

export const LEGACY_ACCESS_LABEL = "Legacy: full access";

export function accessLabel(profile: ApiKeyProfileValue | null): string {
	return (
		API_KEY_PROFILE_OPTIONS.find((option) => option.value === profile)?.label ??
		LEGACY_ACCESS_LABEL
	);
}
