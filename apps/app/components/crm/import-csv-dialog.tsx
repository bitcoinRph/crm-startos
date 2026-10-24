"use client";

import Upload from "@carbon/icons-react/es/Upload";
import { Alert, AlertDescription, AlertTitle } from "@crm/ui/components/alert";
import { Button } from "@crm/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@crm/ui/components/dialog";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@crm/ui/components/field";
import { Icon } from "@crm/ui/components/icon";
import { Input } from "@crm/ui/components/input";
import { Spinner } from "@crm/ui/components/spinner";
import { Textarea } from "@crm/ui/components/textarea";
import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";

type ImportEntity = "companies" | "contacts" | "deals";

type ImportReport = RouterOutputs["csv"]["import"];

const MAX_LISTED = 20;

const HINTS = {
	companies:
		"Matched on domain. A company with no domain is matched on its name.",
	contacts:
		"Matched on email. Import the companies first: a contact finds its company by companyDomain.",
	deals:
		"Matched on name and company. Import the companies first: a deal finds its company by companyDomain.",
} as const satisfies Record<ImportEntity, string>;

const EXAMPLES = {
	companies: "name,domain\nAcme,acme.com",
	contacts:
		"firstName,lastName,email,companyDomain\nDana,Lee,dana@acme.com,acme.com",
	deals:
		"name,companyDomain,stage,amount,currency\nAcme rollout,acme.com,QUALIFIED_TO_BUY,12000,USD",
} as const satisfies Record<ImportEntity, string>;

function plural(count: number, word: string) {
	return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function ReportSummary({ report }: { report: ImportReport }) {
	const listed = report.errors.slice(0, MAX_LISTED);

	return (
		<Alert variant={report.errors.length > 0 ? "warning" : "default"}>
			<AlertTitle>
				{report.dryRun ? "Checked. Nothing was imported yet." : "Imported."}
			</AlertTitle>
			<AlertDescription>
				<p>
					{report.dryRun ? "Will create" : "Created"} {report.create},{" "}
					{report.dryRun ? "will update" : "updated"} {report.update}, skipped{" "}
					{report.skip}, {plural(report.errors.length, "row")} with errors.
				</p>
				{report.ignoredColumns.length > 0 ? (
					<p>Columns left out: {report.ignoredColumns.join(", ")}.</p>
				) : null}
				{report.skipped.length > 0 ? (
					<ul className="list-disc pl-4">
						{report.skipped.slice(0, MAX_LISTED).map((note) => (
							<li key={`${note.row}-${note.message}`}>
								Row {note.row} skipped: {note.message}
							</li>
						))}
					</ul>
				) : null}
				{listed.length > 0 ? (
					<ul className="list-disc pl-4">
						{listed.map((error) => (
							<li key={`${error.row}-${error.message}`}>
								Row {error.row}: {error.message}
							</li>
						))}
						{report.errors.length > listed.length ? (
							<li>
								and {report.errors.length - listed.length} more rows with errors
							</li>
						) : null}
					</ul>
				) : null}
			</AlertDescription>
		</Alert>
	);
}

export function ImportCsvDialog({ entity }: { entity: ImportEntity }) {
	const trpc = useTRPC();
	const cache = useCrmCache();
	const fileId = useId();
	const pasteId = useId();

	const [open, setOpen] = useState(false);
	const [text, setText] = useState("");
	const [report, setReport] = useState<ImportReport | null>(null);

	const importCsv = useMutation(
		trpc.csv.import.mutationOptions({
			onSuccess: async (result) => {
				setReport(result);
				if (result.dryRun) return;
				toast.success(
					`Imported ${plural(result.create + result.update, "row")}.`,
				);
				await cache.everything();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const change = (next: string) => {
		setText(next);
		setReport(null);
	};

	const close = (next: boolean) => {
		setOpen(next);
		if (!next) {
			change("");
			importCsv.reset();
		}
	};

	const ready = report?.dryRun === true && report.create + report.update > 0;

	return (
		<Dialog open={open} onOpenChange={close}>
			<DialogTrigger asChild>
				<Button variant="outline">
					<Icon icon={Upload} data-icon="inline-start" />
					Import CSV
				</Button>
			</DialogTrigger>
			<DialogContent size="wide">
				<DialogHeader>
					<DialogTitle>Import {entity}</DialogTitle>
					<DialogDescription>
						Use the columns the export writes, or a HubSpot export.{" "}
						{HINTS[entity]} Check the file first: nothing is written until you
						import.
					</DialogDescription>
				</DialogHeader>

				<FieldGroup>
					<Field>
						<FieldLabel htmlFor={fileId}>CSV file</FieldLabel>
						<Input
							id={fileId}
							type="file"
							accept=".csv,text/csv"
							onChange={async (event) => {
								const file = event.target.files?.[0];
								if (file) change(await file.text());
							}}
						/>
					</Field>
					<Field>
						<FieldLabel htmlFor={pasteId}>Or paste the CSV</FieldLabel>
						<Textarea
							id={pasteId}
							value={text}
							onChange={(event) => change(event.target.value)}
							spellCheck={false}
							size="bounded"
							placeholder={EXAMPLES[entity]}
						/>
						<FieldDescription>
							The first row names the columns.
						</FieldDescription>
					</Field>
				</FieldGroup>

				{report ? (
					<div role="status" aria-live="polite">
						<ReportSummary report={report} />
					</div>
				) : null}

				<DialogFooter>
					{report && !report.dryRun ? (
						<Button onClick={() => close(false)}>Done</Button>
					) : (
						<>
							<Button
								variant="outline"
								disabled={importCsv.isPending || text.trim() === ""}
								onClick={() =>
									importCsv.mutate({ entity, csv: text, dryRun: true })
								}
							>
								{importCsv.isPending && importCsv.variables?.dryRun ? (
									<Spinner />
								) : null}
								Check file
							</Button>
							<Button
								disabled={importCsv.isPending || !ready}
								onClick={() =>
									importCsv.mutate({ entity, csv: text, dryRun: false })
								}
							>
								{importCsv.isPending &&
								importCsv.variables?.dryRun === false ? (
									<Spinner />
								) : null}
								Import
							</Button>
						</>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
