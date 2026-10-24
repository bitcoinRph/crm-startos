"use client";

import { Button } from "@crm/ui/components/button";
import { Spinner } from "@crm/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RECORD_CHANGES } from "@/components/crm/record-changes-config";
import { LocalDateTime, LocalRelativeTime } from "@/components/local-date-time";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";

type RecordChange = RouterOutputs["recordChanges"]["list"][number];
type ChangeEntity = RecordChange["entity"];
type ChangeValue = NonNullable<RecordChange["after"]>[string];

export type RecordChangesFilter =
	| { entity: ChangeEntity; recordId: string }
	| { apiKeyId: string };

const ACTOR_LABELS = {
	USER: "Person",
	API_KEY: "API key",
	AGENT: "CRM agent",
	SYSTEM: "System",
} as const satisfies Record<RecordChange["actorKind"], string>;

const ENTITY_WORDS = {
	COMPANY: "company",
	CONTACT: "contact",
	DEAL: "deal",
} as const satisfies Record<ChangeEntity, string>;

function columnLabel(column: string): string {
	const words = column
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/[_-]+/g, " ")
		.trim()
		.toLowerCase();
	return words.charAt(0).toUpperCase() + words.slice(1);
}

const STORED_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/;
const DATE_TIME = { dateStyle: "medium", timeStyle: "short" } as const;

function valueText(value: ChangeValue | undefined): string {
	if (value === null || value === undefined || value === "") return "empty";
	return String(value);
}

function ChangeValueText({ text }: { text: string }) {
	if (!STORED_TIMESTAMP.test(text)) return text;
	return <LocalDateTime date={`${text}Z`} options={DATE_TIME} />;
}

function changedLines(change: RecordChange) {
	const keys = [
		...new Set([
			...Object.keys(change.before ?? {}),
			...Object.keys(change.after ?? {}),
		]),
	];
	return keys.map((key) => ({
		key,
		label: change.fieldLabel ?? columnLabel(key),
		before: valueText(change.before?.[key]),
		after: valueText(change.after?.[key]),
	}));
}

function undoLabel(change: RecordChange): string {
	if (change.operation === "CREATE") {
		return `Undo creation of ${ENTITY_WORDS[change.entity]}`;
	}
	const labels = [...new Set(changedLines(change).map((line) => line.label))];
	return labels.length > 0
		? `Undo change to ${labels.join(", ")}`
		: `Undo change to ${ENTITY_WORDS[change.entity]}`;
}

function ChangeLines({ change }: { change: RecordChange }) {
	if (change.operation === "CREATE") return <p>Created</p>;
	const lines = changedLines(change);
	if (lines.length === 0) return <p>Updated</p>;
	return (
		<ul className="flex flex-col gap-0.5">
			{lines.map((line) => (
				<li key={line.key}>
					{line.label}: <ChangeValueText text={line.before} /> →{" "}
					<ChangeValueText text={line.after} />
				</li>
			))}
		</ul>
	);
}

export function RecordChanges({ filter }: { filter: RecordChangesFilter }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const cache = useCrmCache();
	const showRecord = "apiKeyId" in filter;

	const input =
		"apiKeyId" in filter
			? { apiKeyId: filter.apiKeyId, limit: RECORD_CHANGES.list.limit }
			: {
					entity: filter.entity,
					recordId: filter.recordId,
					limit: RECORD_CHANGES.list.limit,
				};
	const changes = useQuery(trpc.recordChanges.list.queryOptions(input));

	const revert = useMutation(
		trpc.recordChanges.revert.mutationOptions({
			onSuccess: async (result) => {
				const record = {
					COMPANY: cache.company,
					CONTACT: cache.contact,
					DEAL: cache.deal,
				}[result.entity];
				await Promise.all([
					record(result.recordId),
					queryClient.invalidateQueries({
						queryKey: trpc.recordChanges.list.pathKey(),
					}),
				]);
				toast.success("Change undone.");
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	if (changes.isPending) {
		return (
			<div className="flex items-center justify-center py-8">
				<Spinner />
			</div>
		);
	}

	if (changes.isError) {
		return (
			<p className="py-8 text-center text-muted-foreground">
				Could not load the changes. {changes.error.message}
			</p>
		);
	}

	if (changes.data.length === 0) {
		return (
			<p className="py-8 text-center text-muted-foreground">
				No recorded changes yet.
			</p>
		);
	}

	return (
		<ul className="divide-y">
			{changes.data.map((change) => (
				<li
					key={change.id}
					data-change={change.id}
					className="flex items-start justify-between gap-3 py-3"
				>
					<div className="flex min-w-0 flex-col gap-1">
						<div className="text-muted-foreground">
							<LocalRelativeTime date={change.createdAt} /> ·{" "}
							{ACTOR_LABELS[change.actorKind]}
							{showRecord
								? ` · ${columnLabel(ENTITY_WORDS[change.entity])}`
								: ""}
						</div>
						<ChangeLines change={change} />
					</div>
					{change.revertible ? (
						<Button
							variant="outline"
							size="sm"
							disabled={revert.isPending}
							aria-label={undoLabel(change)}
							onClick={() => revert.mutate({ id: change.id })}
						>
							Undo
						</Button>
					) : null}
				</li>
			))}
		</ul>
	);
}
