import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	API_KEY_PROFILE_OPTIONS,
	accessLabel,
	DEFAULT_API_KEY_PROFILE,
	LEGACY_ACCESS_LABEL,
} from "../app/(app)/[slug]/settings/api-keys/api-key-profiles";

const source = (path: string) =>
	readFileSync(resolve(import.meta.dir, "..", path), "utf8");

describe("API key profiles in the settings UI", () => {
	it("labels every profile and names a legacy key for what it is", () => {
		for (const option of API_KEY_PROFILE_OPTIONS) {
			expect(accessLabel(option.value)).toBe(option.label);
		}
		expect(accessLabel(null)).toBe(LEGACY_ACCESS_LABEL);
	});

	it("defaults a new key to the integration profile", () => {
		expect(DEFAULT_API_KEY_PROFILE).toBe("crm_integration");
		expect(API_KEY_PROFILE_OPTIONS.map((option) => option.value)).toEqual([
			"crm_integration",
			"agent_propose",
			"agent_read",
		]);
	});

	it("offers the profile when a key is created and shows it in the table", () => {
		const sheet = source(
			"app/(app)/[slug]/settings/api-keys/create-api-key-sheet.tsx",
		);
		expect(sheet).toContain("API_KEY_PROFILE_OPTIONS.map");
		expect(sheet).toContain("profile,");

		const table = source(
			"app/(app)/[slug]/settings/api-keys/api-keys-table.tsx",
		);
		expect(table).toContain('header: "Access"');
		expect(table).toContain("accessLabel(row.profile)");
	});
});
