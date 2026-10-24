"use client";

import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import {
	SimpleTable,
	SimpleTableCell,
	type SimpleTableColumn,
	SimpleTableEmpty,
	SimpleTableRow,
	SimpleTableRowButton,
} from "@crm/ui/components/simple-table";
import { StatusIndicator } from "@crm/ui/components/status-indicator";
import { useQuery } from "@tanstack/react-query";
import { LocalRelativeTime } from "@/components/local-date-time";
import { useTRPC } from "@/lib/trpc/client";
import { SALES_WORKFLOW } from "./sales-workflow-config";

const COLUMNS: SimpleTableColumn[] = [
	{ id: "customer", header: "Customer", width: "w-[40%]" },
	{ id: "status", header: "Status", width: "w-[30%]" },
	{ id: "changes", header: "Changes", width: "w-[12%]", align: "right" },
	{ id: "filed", header: "Filed", width: "w-[18%]", align: "right" },
];

function plural(count: number, word: string) {
	return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function SalesReviewQueue({
	activeId,
	disabled = false,
	onOpen,
}: {
	activeId: string;
	disabled?: boolean;
	onOpen: (requestId: string) => void;
}) {
	const trpc = useTRPC();
	const queue = useQuery(
		trpc.sales.reviewQueue.queryOptions(
			{ limit: SALES_WORKFLOW.queue.limit },
			{ refetchInterval: SALES_WORKFLOW.queue.refreshMs },
		),
	);
	const counts = queue.data?.counts;
	const rows = queue.data?.rows ?? [];

	return (
		<Card data-slot="sales-review-queue">
			<CardHeader>
				<CardTitle>Waiting for review</CardTitle>
				<CardDescription>
					Proposals an agent filed wait for you. Requests without a proposal
					wait for an agent.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="flex flex-col gap-3">
					<p
						aria-live="polite"
						className="text-muted-foreground text-xs"
						data-proposed={counts?.proposed}
						data-pending={counts?.pending}
					>
						{counts
							? `${plural(counts.proposed, "proposal")} to review · ${plural(counts.pending, "request")} waiting for an agent.`
							: queue.isError
								? `Could not load the queue. ${queue.error.message}`
								: "Loading the queue…"}
					</p>
					<SimpleTable columns={COLUMNS} layout="fixed">
						{rows.length ? (
							rows.map((row) => {
								const name = [
									row.contactSnapshot.firstName,
									row.contactSnapshot.lastName,
								]
									.filter(Boolean)
									.join(" ");
								return (
									<SimpleTableRow
										key={row.id}
										clickable={!disabled}
										data-request={row.id}
										data-status={row.status}
										aria-current={row.id === activeId ? "true" : undefined}
										aria-disabled={disabled || undefined}
										onClick={disabled ? undefined : () => onOpen(row.id)}
									>
										<SimpleTableCell truncate>
											<SimpleTableRowButton
												disabled={disabled}
												onClick={(event) => {
													event.stopPropagation();
													onOpen(row.id);
												}}
											>
												{name || row.contactSnapshot.email || row.contactId}
											</SimpleTableRowButton>
										</SimpleTableCell>
										<SimpleTableCell>
											<StatusIndicator
												size="sm"
												tone={row.status === "PROPOSED" ? "primary" : "neutral"}
												label={
													row.status === "PROPOSED"
														? "Ready for your review"
														: "Waiting for the agent"
												}
											/>
										</SimpleTableCell>
										<SimpleTableCell align="right" numeric>
											{row.proposal?.operations.length ?? "—"}
										</SimpleTableCell>
										<SimpleTableCell align="right" muted>
											<LocalRelativeTime date={row.createdAt} />
										</SimpleTableCell>
									</SimpleTableRow>
								);
							})
						) : (
							<SimpleTableEmpty columns={COLUMNS.length}>
								{queue.isPending ? "Loading…" : "Nothing waits for review."}
							</SimpleTableEmpty>
						)}
					</SimpleTable>
				</div>
			</CardContent>
		</Card>
	);
}
