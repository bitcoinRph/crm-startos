import type { Metadata } from "next";
import { Suspense } from "react";
import {
	PageShell,
	PageShellContent,
	PageShellDescription,
	PageShellHeader,
	PageShellHeading,
	PageShellLoading,
	PageShellTitle,
} from "@/components/page-shell";
import { requireSession } from "@/lib/session";
import { HydrateClient } from "@/lib/trpc/hydrate";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { AgentModel, type AgentModelMode } from "./agent-model";
import { ArchiveRetention } from "./archive-retention";
import { ResearchKey } from "./research-key";
import { WorkspaceForm } from "./workspace-form";

export const metadata: Metadata = {
	title: "General",
};

export default function GeneralSettingsPage() {
	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>General</PageShellTitle>
					<PageShellDescription>
						Your workspace, optional research, and inference setup.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>

			<PageShellContent>
				<Suspense fallback={<PageShellLoading />}>
					<Settings />
				</Suspense>
			</PageShellContent>
		</PageShell>
	);
}

async function Settings() {
	await requireSession();
	const mode: AgentModelMode =
		process.env.CRM_INFERENCE_MODE === "LOCAL" ||
		process.env.CRM_INFERENCE_MODE === "LEGACY_GATEWAY"
			? process.env.CRM_INFERENCE_MODE
			: "DISABLED";

	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();

	await Promise.all([
		queryClient.prefetchQuery(trpc.workspace.get.queryOptions()),
		...(mode === "LEGACY_GATEWAY"
			? [
					queryClient.prefetchQuery(trpc.settings.agentModel.queryOptions()),
					queryClient.prefetchQuery(trpc.settings.modelCatalog.queryOptions()),
				]
			: []),
		queryClient.prefetchQuery(trpc.settings.researchKey.queryOptions()),
		queryClient.prefetchQuery(trpc.settings.archiveRetention.queryOptions()),
	]);

	return (
		<HydrateClient>
			<div className="flex max-w-3xl flex-col gap-6">
				<WorkspaceForm />
				<ResearchKey />
				<ArchiveRetention />
				<AgentModel mode={mode} />
			</div>
		</HydrateClient>
	);
}
