import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

for (const rejectProposal of [false, true]) {
	test(`manual worker uses GET polling and ${rejectProposal ? "persists failure" : "stores a proposal"}`, async () => {
		const directory = await mkdtemp(join(tmpdir(), "sales-worker-"));
		const fixture = {
			workerKey: "synthetic-test-key",
			source: "Alex is VP of Sales.",
			contactId: "contact-1",
			operations: [
				{
					type: "contact_fact",
					contactId: "contact-1",
					field: "jobTitle",
					value: "VP of Sales",
					evidence: "VP of Sales",
				},
			],
		};
		const row = {
			id: "00000000-0000-4000-8000-000000000001",
			source: fixture.source,
			contactId: fixture.contactId,
			profileId: "qwen-local-experimental",
			profileRevision: "sales-qwen-v1",
		};
		const calls: {
			method: string;
			path: string;
			body: string;
			key: string | null;
		}[] = [];
		let polls = 0;
		const server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			async fetch(request) {
				const path = new URL(request.url).pathname;
				calls.push({
					method: request.method,
					path,
					body: await request.text(),
					key: request.headers.get("x-api-key"),
				});
				if (
					path === "/rest/sales/requests/pending" &&
					request.method === "GET"
				) {
					return Response.json(++polls === 1 ? [] : [row]);
				}
				if (path === "/rest/sales/proposals" && request.method === "POST") {
					return Response.json({}, { status: rejectProposal ? 409 : 200 });
				}
				if (path === "/rest/sales/requests/fail" && request.method === "POST") {
					return Response.json({});
				}
				return new Response("Unexpected route", { status: 405 });
			},
		});
		const path = join(directory, "fixture.json");
		await writeFile(path, JSON.stringify(fixture));
		const child = Bun.spawn(
			[
				process.execPath,
				join(import.meta.dir, "e2e/sales-worker.e2e.ts"),
				path,
			],
			{
				env: {
					...process.env,
					API_URL: server.url.origin,
					CRM_TELEMETRY_DISABLED: "1",
				},
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const timer = setTimeout(() => child.kill(), 10000);
		try {
			const [exit, stdout, stderr] = await Promise.all([
				child.exited,
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
			]);
			expect(exit).toBe(rejectProposal ? 1 : 0);
			expect(calls.map(({ method, path }) => `${method} ${path}`)).toEqual([
				"GET /rest/sales/requests/pending",
				"GET /rest/sales/requests/pending",
				"POST /rest/sales/proposals",
				...(rejectProposal ? ["POST /rest/sales/requests/fail"] : []),
			]);
			expect(calls.slice(0, 2).map(({ body }) => body)).toEqual(["", ""]);
			expect(calls.every(({ key }) => key === fixture.workerKey)).toBe(true);
			expect(JSON.parse(calls[2].body)).toEqual({
				requestId: row.id,
				operations: fixture.operations,
				producedBy: "injected-synthetic",
			});
			if (rejectProposal) {
				expect(JSON.parse(calls[3].body)).toEqual({ requestId: row.id });
				expect(stderr).toContain("Store proposal failed: 409");
			} else {
				expect(JSON.parse(stdout)).toEqual({
					requestId: row.id,
					mode: "injected-synthetic",
					stored: true,
				});
			}
		} finally {
			clearTimeout(timer);
			child.kill();
			server.stop(true);
			await rm(directory, { recursive: true, force: true });
		}
	}, 15000);
}
