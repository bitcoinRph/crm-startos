import { describe, expect, test } from "bun:test";
import {
	downstreamResponseHeaders,
	isProxiedPath,
	upstreamRequestHeaders,
	webOpenApiDocument,
} from "../lib/api-proxy-request";

describe("API proxy requests", () => {
	test("forwards only the paths the web origin serves for the API", () => {
		for (const path of [
			"/api",
			"/api/trpc/contacts.list",
			"/rest/sales/requests/review-queue",
			"/openapi.json",
		])
			expect(isProxiedPath(path)).toBe(true);
		for (const path of [
			"/health",
			"/internal/sync/rates",
			"/restricted",
			"/apis",
			"/openapi.json.bak",
			new URL("http://crm.local/rest/%2e%2e/internal/sync/rates").pathname,
		])
			expect(isProxiedPath(path)).toBe(false);
	});

	test("drops hop-by-hop headers and the headers that connection names", () => {
		const headers = upstreamRequestHeaders(
			new Headers({
				connection: "keep-alive, x-private",
				"x-private": "1",
				upgrade: "h2c",
				te: "gzip",
				host: "crm.local",
				"x-api-key": "key",
				authorization: "Bearer token",
			}),
		);
		expect([...headers.keys()].sort()).toEqual(["authorization", "x-api-key"]);
	});

	test("keeps every set-cookie line and drops body framing from the API", () => {
		const upstream = new Headers({
			"content-type": "application/json",
			"content-encoding": "gzip",
			"content-length": "10",
			"keep-alive": "timeout=5",
		});
		upstream.append("set-cookie", "a=1; Path=/");
		upstream.append("set-cookie", "b=2; Path=/");
		const headers = downstreamResponseHeaders(upstream);
		expect(headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/"]);
		expect(headers.get("content-type")).toBe("application/json");
		for (const name of ["content-encoding", "content-length", "keep-alive"])
			expect(headers.has(name)).toBe(false);
	});

	test("lists only reachable paths in the web OpenAPI document", () => {
		const document = webOpenApiDocument({
			openapi: "3.0.0",
			paths: {
				"/health": {},
				"/internal/sync/rates": {},
				"/api/t/e": {},
				"/rest/sales/requests/review-queue": {},
			},
		});
		expect(document.openapi).toBe("3.0.0");
		expect(Object.keys(document.paths)).toEqual([
			"/api/t/e",
			"/rest/sales/requests/review-queue",
		]);
	});
});
