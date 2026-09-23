import { describe, expect, it } from "bun:test";
import { useQueryClient } from "@tanstack/react-query";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { renderToStaticMarkup } from "react-dom/server";
import {
	type SalesRequest,
	SalesWorkflow,
} from "../app/(app)/[slug]/sales/sales-workflow";
import { TRPCReactProvider, useTRPC } from "../lib/trpc/client";

const request: SalesRequest = {
	id: "00000000-0000-4000-8000-000000000001",
	idempotencyKey: "00000000-0000-4000-8000-000000000002",
	source: "Synthetic customer note",
	contactId: "contact-1",
	contactSnapshot: {
		id: "contact-1",
		firstName: "Synthetic",
		lastName: "Buyer",
		email: "buyer@example.invalid",
		title: null,
		updatedAt: "2026-09-22T00:00:00.000Z",
	},
	expectedUpdatedAt: "2026-09-22T00:00:00.000Z",
	profileId: "qwen-local-experimental",
	profileRevision: "sales-qwen-v1",
	requestedById: "human",
	requestedByKeyId: null,
	status: "PENDING",
	error: null,
	createdAt: "2026-09-22T00:00:00.000Z",
	proposal: null,
};

function SeedRequest({ value, error }: { value: SalesRequest; error?: Error }) {
	const trpc = useTRPC();
	const client = useQueryClient();
	const queryKey = trpc.sales.getRequest.queryKey({ requestId: value.id });
	if (error) {
		client.setQueryDefaults(queryKey, { retryOnMount: false });
		client
			.getQueryCache()
			.build(client, { queryKey })
			.setState({ status: "error", error });
	} else {
		client.setQueryData(queryKey, value);
	}
	return <SalesWorkflow />;
}

function render(searchParams: string, value = request, error?: Error) {
	return renderToStaticMarkup(
		<NuqsTestingAdapter searchParams={searchParams}>
			<TRPCReactProvider>
				<SeedRequest value={value} error={error} />
			</TRPCReactProvider>
		</NuqsTestingAdapter>,
	);
}

describe("sales request URL recovery", () => {
	it("restores a pending request from a copied URL on each mount", () => {
		for (let mount = 0; mount < 2; mount++) {
			const html = render(`?requestId=${request.id}`);
			expect(html).toContain(request.id);
			expect(html).toContain("PENDING");
			expect(html).toContain(request.source);
			expect(html).not.toContain("Create proposal request");
			expect(html).toContain("Start another request");
		}
	});
	it("offers Open request without creating or approving anything", () => {
		const html = render("");
		expect(html).toContain('id="sales-open-request"');
		expect(html).toContain("Open request");
		expect(html).toContain("Create proposal request");
		expect(html).not.toContain("Approve proposal");
		expect(html).not.toContain(request.source);
	});
	it("keeps recovery controls for failed and inaccessible requests", () => {
		const failed = render(`?requestId=${request.id}`, {
			...request,
			status: "FAILED",
			error: "Inference unavailable",
		});
		expect(failed).toContain("Inference unavailable");
		const inaccessible = render(
			`?requestId=${request.id}`,
			request,
			new Error("Request not found"),
		);
		for (const html of [failed, inaccessible]) {
			expect(html).toContain("Open request");
			expect(html).toContain("Start another request");
			expect(html).not.toContain("Approve proposal");
		}
		expect(inaccessible).toContain("Request not found");
		expect(inaccessible).toContain("Retry request status");
	});
});
