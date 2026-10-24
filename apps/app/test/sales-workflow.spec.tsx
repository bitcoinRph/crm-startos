import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	type SalesRequest,
	SalesRequestReview,
} from "../app/(app)/[slug]/sales/sales-workflow";

const request: SalesRequest = {
	id: "00000000-0000-4000-8000-000000000001",
	idempotencyKey: "00000000-0000-4000-8000-000000000002",
	source: "Synthetic note: Chief Buyer\nCall on Friday <script>",
	contactId: "synthetic-contact",
	contactSnapshot: {
		id: "synthetic-contact",
		firstName: "Synthetic",
		lastName: "Buyer",
		email: "buyer@example.invalid",
		title: "Buyer",
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

function render(
	value: SalesRequest,
	approving = false,
	extra: { stalled?: boolean } = {},
) {
	return renderToStaticMarkup(
		createElement(SalesRequestReview, {
			request: value,
			approving,
			onApprove: () => {},
			...extra,
		}),
	);
}

function proposed(
	decision: Partial<NonNullable<SalesRequest["proposal"]>> = {},
): SalesRequest {
	return {
		...request,
		status: "PROPOSED",
		proposal: {
			id: "00000000-0000-4000-8000-000000000003",
			requestId: request.id,
			idempotencyKey: "00000000-0000-4000-8000-000000000004",
			operations: [
				{
					type: "contact_fact",
					contactId: request.contactId,
					field: "jobTitle",
					value: "Chief Buyer",
					evidence: "Chief Buyer",
				},
			],
			proposedById: "human",
			proposedByKeyId: "key-hermes",
			producedBy: "hermes/qwen3.5:4b",
			createdAt: request.createdAt,
			approvedAt: null,
			approvedById: null,
			approvedSessionId: null,
			appliedActivityIds: [],
			rejectedAt: null,
			rejectedById: null,
			rejectedSessionId: null,
			rejectionReason: null,
			...decision,
		},
	};
}

describe("fixed sales workflow review", () => {
	it("shows persisted source, customer, revision and pending status without approval", () => {
		const html = render(request);
		for (const value of [
			"Synthetic Buyer",
			"synthetic-contact",
			request.expectedUpdatedAt,
			"PENDING",
			"qwen-local-experimental",
			"sales-qwen-v1",
			"No CRM records change before approval.",
			"Call on Friday &lt;script&gt;",
		])
			expect(html).toContain(value);
		expect(html).not.toContain("Approve proposal");
	});
	it("shows exact evidence and value before explicit approval", () => {
		const html = render(proposed());
		expect(html).toContain("Exact value");
		expect(html).toContain("Exact evidence");
		expect(html.match(/Chief Buyer/g)?.length).toBe(3);
		expect(html).toContain("jobTitle");
		expect(html).toContain("Approve proposal");
	});
	it("labels each status in words and keeps the raw status for automation", () => {
		const labels = {
			PENDING: "Waiting for the agent",
			PROPOSED: "Ready for your review",
			APPROVED: "Approved",
			REJECTED: "Rejected",
			FAILED: "Failed",
		} as const;
		for (const [status, label] of Object.entries(labels)) {
			const html = render({
				...request,
				status: status as SalesRequest["status"],
			});
			expect(html).toContain(label);
			expect(html).toContain(`data-status="${status}"`);
		}
	});
	it("offers a reject action beside approve while a proposal waits", () => {
		const html = render(proposed());
		expect(html).toContain("Approve proposal");
		expect(html).toContain("Reject proposal");
	});
	it("shows who rejected and why, with no decision left to take", () => {
		const html = render({
			...proposed({
				rejectedAt: "2026-09-23T00:00:00.000Z",
				rejectedById: "human",
				rejectedSessionId: "session",
				rejectionReason: "Different Dana",
			}),
			status: "REJECTED",
		});
		expect(html).toContain("Rejected");
		expect(html).toContain("Different Dana");
		expect(html).not.toContain("Approve proposal");
		expect(html).not.toContain("Reject proposal");
	});
	it("says when the page stopped waiting for the agent", () => {
		const html = render(request, false, { stalled: true });
		expect(html).toContain("No proposal after");
		expect(html).toContain("Check again");
		expect(html).not.toContain("This page updates by itself.");
	});
	it("keeps the approval guarantee outside the description that phones hide", () => {
		const html = render(request);
		const guarantee = html.indexOf("No CRM records change before approval.");
		expect(guarantee).toBeGreaterThan(html.indexOf('data-slot="card-content"'));
	});
	it("shows worker errors without an approval action", () => {
		const html = render({
			...request,
			status: "FAILED",
			error: "Inference unavailable",
		});
		expect(html).toContain("Inference unavailable");
		expect(html).not.toContain("Approve proposal");
	});
});
