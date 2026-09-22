import { describe, expect, it } from "bun:test";
import {
	API_KEY_PROFILES,
	KEY_PERMISSIONS,
	parseStoredPermissions,
	permits,
	profileOf,
} from "../src/api-keys/api-key-profiles";

describe("API key profiles", () => {
	it("maps every profile back from its stored permissions", () => {
		for (const profile of API_KEY_PROFILES) {
			const stored = JSON.stringify(KEY_PERMISSIONS[profile]);
			expect(profileOf(parseStoredPermissions(stored))).toBe(profile);
		}
	});

	it("recognises a profile whatever the key and action order", () => {
		expect(
			profileOf({ sales: ["proposal:write", "read"], crm: ["read"] }),
		).toBe("agent_propose");
	});

	it("reports a legacy key and a hand-edited permission set as no profile", () => {
		expect(profileOf(parseStoredPermissions(null))).toBeNull();
		expect(profileOf(parseStoredPermissions(""))).toBeNull();
		expect(profileOf({ crm: ["read", "write", "purge"] })).toBeNull();
	});

	it("rejects stored permissions that are not a resource map", () => {
		expect(() => parseStoredPermissions('{"crm":"read"}')).toThrow();
		expect(() => parseStoredPermissions("[]")).toThrow();
	});

	it("grants only what a profile lists", () => {
		expect(permits(KEY_PERMISSIONS.agent_read, "crm", "read")).toBe(true);
		expect(permits(KEY_PERMISSIONS.agent_read, "crm", "write")).toBe(false);
		expect(permits(KEY_PERMISSIONS.agent_read, "sales", "read")).toBe(false);
		expect(
			permits(KEY_PERMISSIONS.agent_propose, "sales", "proposal:write"),
		).toBe(true);
		expect(permits(KEY_PERMISSIONS.agent_propose, "crm", "write")).toBe(false);
		expect(permits(KEY_PERMISSIONS.crm_integration, "crm", "write")).toBe(true);
		expect(permits(KEY_PERMISSIONS.crm_integration, "sales", "read")).toBe(
			false,
		);
	});
});
