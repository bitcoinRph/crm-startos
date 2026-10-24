import { describe, expect, it } from "bun:test";
import {
	intakeCurl,
	intakeEndpoint,
	intakeOrigin,
} from "../app/(app)/[slug]/settings/connections/intake/intake-example";

const fallback = "http://localhost:3000";

describe("intake endpoint example", () => {
	it("builds the endpoint from the origin the page was served on", () => {
		expect(intakeEndpoint("https://crm.example.com")).toBe(
			"https://crm.example.com/api/trpc/intake.submit",
		);
	});

	it("reads the origin from the forwarded headers first", () => {
		const headers = new Headers({
			host: "127.0.0.1:3000",
			"x-forwarded-host": "crm.example.com",
			"x-forwarded-proto": "https",
		});
		expect(intakeOrigin(headers, fallback)).toBe("https://crm.example.com");
	});

	it("falls back to the host header and then to the configured origin", () => {
		expect(
			intakeOrigin(new Headers({ host: "crm.local:8080" }), fallback),
		).toBe("https://crm.local:8080");
		expect(
			intakeOrigin(new Headers({ host: "localhost:3000" }), fallback),
		).toBe("http://localhost:3000");
		expect(intakeOrigin(new Headers(), fallback)).toBe(fallback);
	});

	it("shows a curl call with the bearer key and a JSON body", () => {
		const curl = intakeCurl("https://crm.example.com");
		expect(curl).toContain(
			"curl -X POST https://crm.example.com/api/trpc/intake.submit",
		);
		expect(curl).toContain("Authorization: Bearer crm_");
		expect(curl).toContain("Content-Type: application/json");
		expect(curl).toContain('"email"');
	});
});
