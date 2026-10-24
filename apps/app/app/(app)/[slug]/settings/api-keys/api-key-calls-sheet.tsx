"use client";

import Report from "@carbon/icons-react/es/Report";
import { Badge } from "@crm/ui/components/badge";
import { Button } from "@crm/ui/components/button";
import { Icon } from "@crm/ui/components/icon";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@crm/ui/components/sheet";
import {
	SimpleTable,
	type SimpleTableColumn,
	SimpleTableRow,
} from "@crm/ui/components/simple-table";
import { TableCell } from "@crm/ui/components/table";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { LocalRelativeTime } from "@/components/local-date-time";
import { useTRPC } from "@/lib/trpc/client";

function callTypeLabel(type: string) {
	if (type === "query") return "Read";
	if (type === "mutation") return "Write";
	return type;
}

const COLUMNS: SimpleTableColumn[] = [
	{ id: "when", header: "When", width: "w-[22%]" },
	{ id: "procedure", header: "Procedure", width: "w-[44%]" },
	{ id: "type", header: "Type", width: "w-[16%]" },
	{ id: "outcome", header: "Result", width: "w-[18%]" },
];

export function ApiKeyCallsSheet({
	id,
	name,
}: {
	id: string;
	name: string | null;
}) {
	const trpc = useTRPC();
	const [open, setOpen] = useState(false);
	const calls = useQuery(
		trpc.apiKeys.calls.queryOptions({ id }, { enabled: open }),
	);
	const label = name ?? "this API key";

	return (
		<Sheet open={open} onOpenChange={setOpen}>
			<SheetTrigger asChild>
				<Button variant="ghost" size="icon">
					<Icon icon={Report} />
					<span className="sr-only">Recent calls of {label}</span>
				</Button>
			</SheetTrigger>

			<SheetContent side="right" size="lg">
				<SheetHeader>
					<SheetTitle>Recent calls</SheetTitle>
					<SheetDescription>
						The last 50 calls made with {label}, newest first. Arguments are
						never stored.
					</SheetDescription>
				</SheetHeader>

				<div className="flex-1 overflow-y-auto px-4">
					<SimpleTable columns={COLUMNS} className="table-fixed">
						{calls.data?.length ? (
							calls.data.map((call) => (
								<SimpleTableRow
									key={`${call.createdAt}-${call.procedure}`}
									data-outcome={call.outcome}
								>
									<TableCell className="px-3 py-2 text-muted-foreground">
										<LocalRelativeTime date={call.createdAt} />
									</TableCell>
									<TableCell className="overflow-hidden px-3 py-2">
										<span className="block truncate font-mono">
											{call.procedure}
										</span>
									</TableCell>
									<TableCell className="px-3 py-2 text-muted-foreground">
										{callTypeLabel(call.type)}
									</TableCell>
									<TableCell className="px-3 py-2">
										<Badge
											variant={
												call.outcome === "denied" ? "destructive" : "outline"
											}
										>
											{call.outcome === "denied" ? "Denied" : "Allowed"}
										</Badge>
									</TableCell>
								</SimpleTableRow>
							))
						) : (
							<SimpleTableRow>
								<TableCell
									colSpan={COLUMNS.length}
									className="h-24 text-center text-muted-foreground"
								>
									{calls.isError
										? `Could not load the calls. ${calls.error.message}`
										: calls.isPending
											? "Loading…"
											: "No calls yet."}
								</TableCell>
							</SimpleTableRow>
						)}
					</SimpleTable>
				</div>
			</SheetContent>
		</Sheet>
	);
}
