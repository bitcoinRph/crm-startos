import { describe, expect, it } from "bun:test";
import { useQueryClient } from "@tanstack/react-query";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { renderToStaticMarkup } from "react-dom/server";
import { SalesReviewQueue } from "../app/(app)/[slug]/sales/sales-review-queue";
import {
	type SalesRequest,
	SalesWorkflow,
} from "../app/(app)/[slug]/sales/sales-workflow";
import { SALES_WORKFLOW } from "../app/(app)/[slug]/sales/sales-workflow-config";
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

function SeedRequest({
	value,
	error,
	checkedAt,
}: {
	value: SalesRequest;
	error?: Error;
	checkedAt?: number;
}) {
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
		client.setQueryData(queryKey, value, { updatedAt: checkedAt });
	}
	return <SalesWorkflow />;
}

function render(
	searchParams: string,
	value = request,
	error?: Error,
	checkedAt?: number,
) {
	return renderToStaticMarkup(
		<NuqsTestingAdapter searchParams={searchParams}>
			<TRPCReactProvider>
				<SeedRequest value={value} error={error} checkedAt={checkedAt} />
			</TRPCReactProvider>
		</NuqsTestingAdapter>,
	);
}

describe("sales request URL recovery", () => {
	it("calls a request stalled from the last check, not from the render time", () => {
		const created = Date.parse(request.createdAt);
		const early = render(
			`?requestId=${request.id}`,
			request,
			undefined,
			created + SALES_WORKFLOW.pollTimeoutMs - 1,
		);
		expect(early).toContain("This page updates by itself.");
		expect(early).not.toContain("No proposal after");
		const late = render(
			`?requestId=${request.id}`,
			request,
			undefined,
			created + SALES_WORKFLOW.pollTimeoutMs + 1,
		);
		expect(late).toContain("No proposal after");
		expect(late).toContain("Check again");
	});

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

function SeedQueue({ disabled = false }: { disabled?: boolean }) {
	const trpc = useTRPC();
	const client = useQueryClient();
	client.setQueryData(
		trpc.sales.reviewQueue.queryKey({ limit: SALES_WORKFLOW.queue.limit }),
		{
			rows: [{ ...request, status: "PENDING" as const }],
			counts: { pending: 1, proposed: 0 },
		},
	);
	if (disabled)
		return <SalesReviewQueue activeId="" disabled onOpen={() => {}} />;
	return <SalesWorkflow />;
}

describe("sales review queue", () => {
	it("lists waiting requests with their raw status for automation", () => {
		const html = renderToStaticMarkup(
			<NuqsTestingAdapter searchParams="">
				<TRPCReactProvider>
					<SeedQueue />
				</TRPCReactProvider>
			</NuqsTestingAdapter>,
		);
		expect(html).toContain("Waiting for review");
		expect(html).toContain(`data-request="${request.id}"`);
		expect(html).toContain('data-status="PENDING"');
		expect(html).toContain("0 proposals to review · 1 request waiting");
		expect(html).toContain("Synthetic Buyer");
	});

	it("locks every row while a decision on the page is running", () => {
		const html = renderToStaticMarkup(
			<NuqsTestingAdapter searchParams="">
				<TRPCReactProvider>
					<SeedQueue disabled />
				</TRPCReactProvider>
			</NuqsTestingAdapter>,
		);
		expect(html).toContain('aria-disabled="true"');
		expect(html).toMatch(
			/<button[^>]*disabled=""[^>]*data-slot="simple-table-row-button"|<button[^>]*data-slot="simple-table-row-button"[^>]*disabled=""/,
		);
		expect(html).not.toContain("cursor-pointer [&amp;&gt;td");
	});
});
