import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	type PinnedFetchInit,
	safeFetch,
	safeFetchTransport,
} from "../src/safe-fetch";

type Lookup = typeof safeFetchTransport.lookup;
type Answer = Awaited<ReturnType<Lookup>>;
type Call = { url: URL; init: PinnedFetchInit };

const original = { ...safeFetchTransport };

function answers(...byLookup: Record<string, Answer>[]) {
	const seen: string[] = [];
	safeFetchTransport.lookup = async (hostname) => {
		seen.push(hostname);
		const table = byLookup[Math.min(seen.length, byLookup.length) - 1];
		const answer = table?.[hostname];
		if (!answer) throw new Error(`${hostname} did not resolve`);
		return answer;
	};
	return seen;
}

function transport(respond: (call: Call) => Response | Error) {
	const calls: Call[] = [];
	safeFetchTransport.fetch = async (url, init) => {
		const call = { url, init };
		calls.push(call);
		const result = respond(call);
		if (result instanceof Error) throw result;
		return result;
	};
	return calls;
}

function headerOf(call: Call | undefined, name: string) {
	return new Headers(call?.init.headers).get(name);
}

beforeEach(() => {
	safeFetchTransport.lookup = original.lookup;
	safeFetchTransport.fetch = original.fetch;
});

afterEach(() => {
	safeFetchTransport.lookup = original.lookup;
	safeFetchTransport.fetch = original.fetch;
});

describe("safeFetch address pinning", () => {
	it("connects to the address that passed the check, not a second lookup", async () => {
		const seen = answers(
			{ "rebind.test": [{ address: "93.184.216.34", family: 4 }] },
			{ "rebind.test": [{ address: "10.0.0.5", family: 4 }] },
		);
		const calls = transport(() => new Response("ok"));

		const result = await safeFetch("http://rebind.test/logo.png");

		expect(result?.response.status).toBe(200);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.url.hostname).toBe("93.184.216.34");
		expect(calls[0]?.url.pathname).toBe("/logo.png");
		expect(headerOf(calls[0], "host")).toBe("rebind.test");
		expect(seen).toEqual(["rebind.test"]);
	});

	it("keeps the original host and port in Host and the TLS server name", async () => {
		answers({ "example.test": [{ address: "93.184.216.34", family: 4 }] });
		const calls = transport(() => new Response("ok"));

		const result = await safeFetch("https://example.test:8443/a?b=1");

		expect(result?.url.href).toBe("https://example.test:8443/a?b=1");
		expect(calls[0]?.url.href).toBe("https://93.184.216.34:8443/a?b=1");
		expect(headerOf(calls[0], "host")).toBe("example.test:8443");
		expect(calls[0]?.init.tls?.serverName).toBe("example.test");
	});

	it("brackets an IPv6 address in the pinned URL", async () => {
		answers({
			"v6.test": [{ address: "2606:4700:4700::1111", family: 6 }],
		});
		const calls = transport(() => new Response("ok"));

		await safeFetch("https://v6.test/");

		expect(calls[0]?.url.hostname).toBe("[2606:4700:4700::1111]");
		expect(headerOf(calls[0], "host")).toBe("v6.test");
		expect(calls[0]?.init.tls?.serverName).toBe("v6.test");
	});

	it("tries the next checked address when a connection fails", async () => {
		answers({
			"two.test": [
				{ address: "2606:4700:4700::1111", family: 6 },
				{ address: "93.184.216.34", family: 4 },
			],
		});
		const calls = transport((call) =>
			call.url.hostname.startsWith("[")
				? new Error("unreachable")
				: new Response("ok"),
		);

		const result = await safeFetch("http://two.test/");

		expect(result?.response.status).toBe(200);
		expect(calls.map((call) => call.url.hostname)).toEqual([
			"[2606:4700:4700::1111]",
			"93.184.216.34",
		]);
	});

	it("pins every redirect hop to the address it checked", async () => {
		answers({
			"first.test": [{ address: "93.184.216.34", family: 4 }],
			"second.test": [{ address: "8.8.8.8", family: 4 }],
		});
		const calls = transport((call) =>
			call.url.hostname === "93.184.216.34"
				? new Response(null, {
						status: 302,
						headers: { location: "http://second.test/next" },
					})
				: new Response("done"),
		);

		const result = await safeFetch("http://first.test/start");

		expect(result?.url.href).toBe("http://second.test/next");
		expect(calls.map((call) => call.url.hostname)).toEqual([
			"93.184.216.34",
			"8.8.8.8",
		]);
		expect(headerOf(calls[1], "host")).toBe("second.test");
	});

	it("does not follow a redirect to a private host", async () => {
		answers({
			"first.test": [{ address: "93.184.216.34", family: 4 }],
			"inner.test": [{ address: "10.0.0.5", family: 4 }],
		});
		const calls = transport(
			() =>
				new Response(null, {
					status: 302,
					headers: { location: "http://inner.test/" },
				}),
		);

		expect(await safeFetch("http://first.test/")).toBeNull();
		expect(calls).toHaveLength(1);
	});

	it("does not rewrite an IP literal", async () => {
		const seen = answers({});
		const calls = transport(() => new Response("ok"));

		await safeFetch("https://1.1.1.1/x");

		expect(seen).toEqual([]);
		expect(calls[0]?.url.href).toBe("https://1.1.1.1/x");
		expect(calls[0]?.init.tls).toBeUndefined();
		expect(headerOf(calls[0], "host")).toBeNull();
	});
});

describe("safeFetch refusals", () => {
	it("refuses a host that resolves to a private address", async () => {
		answers({ "inner.test": [{ address: "192.168.1.10", family: 4 }] });
		const calls = transport(() => new Response("ok"));

		expect(await safeFetch("http://inner.test/")).toBeNull();
		expect(calls).toHaveLength(0);
	});

	it("refuses a host when any answer is private", async () => {
		answers({
			"mixed.test": [
				{ address: "93.184.216.34", family: 4 },
				{ address: "169.254.169.254", family: 4 },
			],
		});
		const calls = transport(() => new Response("ok"));

		expect(await safeFetch("http://mixed.test/")).toBeNull();
		expect(calls).toHaveLength(0);
	});

	it("refuses private IP literals including [::1]", async () => {
		const calls = transport(() => new Response("ok"));

		for (const url of [
			"http://127.0.0.1/",
			"http://[::1]/",
			"http://10.0.0.1:8080/",
			"http://[::ffff:7f00:1]/",
			"http://169.254.169.254/latest",
		])
			expect(await safeFetch(url)).toBeNull();
		expect(calls).toHaveLength(0);
	});

	it("refuses a host that does not resolve and non-http schemes", async () => {
		answers({});
		const calls = transport(() => new Response("ok"));

		expect(await safeFetch("http://nowhere.test/")).toBeNull();
		expect(await safeFetch("file:///etc/passwd")).toBeNull();
		expect(await safeFetch("not a url")).toBeNull();
		expect(calls).toHaveLength(0);
	});
});
