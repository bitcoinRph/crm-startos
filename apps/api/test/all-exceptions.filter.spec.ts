import { describe, expect, it } from "bun:test";
import type { ArgumentsHost } from "@nestjs/common";
import { APIError } from "better-auth/api";
import { AllExceptionsFilter } from "../src/logging/all-exceptions.filter";

type Sent = { status: number; body: { statusCode: number; message: string } };

function run(exception: Error) {
	const sent: Sent[] = [];
	const response = {
		headersSent: false,
		status(status: number) {
			return {
				json(body: Sent["body"]) {
					sent.push({ status, body });
				},
			};
		},
	};
	const host = {
		getType: () => "http",
		switchToHttp: () => ({
			getRequest: () => ({ method: "GET", originalUrl: "/files", route: {} }),
			getResponse: () => response,
		}),
	} as unknown as ArgumentsHost;
	new AllExceptionsFilter().catch(exception, host);
	const [first] = sent;
	if (!first) throw new Error("The filter sent no response.");
	return first;
}

describe("AllExceptionsFilter", () => {
	it("answers a rate-limited key with its 429 status", () => {
		const sent = run(
			new APIError("TOO_MANY_REQUESTS", {
				message: "Rate limit exceeded.",
				code: "RATE_LIMITED",
			}),
		);
		expect(sent.status).toBe(429);
		expect(sent.body).toMatchObject({
			statusCode: 429,
			message: "Rate limit exceeded.",
		});
	});

	it("keeps every other failure as a 500 without its message", () => {
		const sent = run(new Error("database password leaked"));
		expect(sent.status).toBe(500);
		expect(sent.body).toEqual({
			statusCode: 500,
			message: "Internal server error",
		});
	});
});
