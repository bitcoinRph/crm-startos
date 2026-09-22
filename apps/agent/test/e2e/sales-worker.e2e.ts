import { readFileSync } from "node:fs";
import { z } from "zod";
import { processSalesRequest } from "../agent/lib/sales-workflow";

const fixture = z
	.object({
		workerKey: z.string(),
		source: z.string(),
		contactId: z.string(),
		operations: z.array(z.unknown()),
	})
	.parse(JSON.parse(readFileSync(process.argv[2], "utf8")));
const live = process.argv.includes("--live");
const deadline = Date.now() + 120000;
const base = `${process.env.API_URL ?? "http://127.0.0.1:3001"}/rest`;
const headers = {
	"Content-Type": "application/json",
	"x-api-key": fixture.workerKey,
};
while (Date.now() < deadline) {
	const pending = await fetch(`${base}/sales/requests/pending`, {
		method: "POST",
		headers,
		body: "{}",
		signal: AbortSignal.timeout(5000),
	});
	if (!pending.ok) throw new Error(`Pending request failed: ${pending.status}`);
	const rows = z
		.array(
			z
				.object({ id: z.string(), source: z.string(), contactId: z.string() })
				.passthrough(),
		)
		.parse(await pending.json());
	const row = rows.find(
		(r) => r.contactId === fixture.contactId && r.source === fixture.source,
	);
	if (row) {
		try {
			await processSalesRequest(
				row,
				async (body) => {
					const response = await fetch(`${base}/sales/proposals`, {
						method: "POST",
						headers,
						body: JSON.stringify(body),
						signal: AbortSignal.timeout(5000),
					});
					if (!response.ok)
						throw new Error(`Store proposal failed: ${response.status}`);
					return response.json();
				},
				live ? "crm-agent/qwen-local-experimental" : "injected-synthetic",
				live ? undefined : async () => fixture.operations,
			);
		} catch (error) {
			const failed = await fetch(`${base}/sales/requests/fail`, {
				method: "POST",
				headers,
				body: JSON.stringify({ requestId: row.id }),
				signal: AbortSignal.timeout(5000),
			});
			if (!failed.ok)
				throw new Error(`Failure persistence failed: ${failed.status}`);
			throw error;
		}
		console.log(
			JSON.stringify({
				requestId: row.id,
				mode: live ? "live-local" : "injected-synthetic",
				stored: true,
			}),
		);
		process.exit(0);
	}
	await new Promise((resolve) => setTimeout(resolve, 500));
}
throw new Error("No matching synthetic request before deadline.");
