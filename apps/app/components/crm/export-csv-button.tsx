"use client";

import Download from "@carbon/icons-react/es/Download";
import { Button } from "@crm/ui/components/button";
import { Icon } from "@crm/ui/components/icon";
import { Spinner } from "@crm/ui/components/spinner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTRPC } from "@/lib/trpc/client";

const UTF8_BOM = "﻿";

type ExportEntity = "companies" | "contacts" | "deals";

function saveFile(filename: string, text: string) {
	const url = URL.createObjectURL(
		new Blob([UTF8_BOM, text], { type: "text/csv;charset=utf-8" }),
	);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	link.click();
	URL.revokeObjectURL(url);
}

export function ExportCsvButton({ entity }: { entity: ExportEntity }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const exportCsv = useMutation({
		mutationFn: () =>
			queryClient.fetchQuery({
				...trpc.csv.export.queryOptions({ entity }),
				staleTime: 0,
				gcTime: 0,
			}),
		onSuccess: (result) => {
			saveFile(result.filename, result.csv);
			if (result.truncated) {
				toast.warning(
					`Exported the first ${result.rows} ${entity}. The export has a row limit.`,
				);
				return;
			}
			toast.success(`Exported ${result.rows} ${entity}.`);
		},
		onError: (error) => toast.error(error.message),
	});

	return (
		<Button
			variant="outline"
			disabled={exportCsv.isPending}
			onClick={() => exportCsv.mutate()}
		>
			{exportCsv.isPending ? (
				<Spinner data-icon="inline-start" />
			) : (
				<Icon icon={Download} data-icon="inline-start" />
			)}
			Export CSV
		</Button>
	);
}
