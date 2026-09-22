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
import { SalesWorkflow } from "./sales-workflow";

export const metadata: Metadata = { title: "Sales workflow" };

export default function SalesPage() {
	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Sales workflow</PageShellTitle>
					<PageShellDescription>
						Turn a synthetic note into a reviewed, evidence-backed proposal.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>
			<PageShellContent>
				<Suspense fallback={<PageShellLoading />}>
					<AuthenticatedSalesWorkflow />
				</Suspense>
			</PageShellContent>
		</PageShell>
	);
}

async function AuthenticatedSalesWorkflow() {
	await requireSession();
	return <SalesWorkflow />;
}
