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

export const metadata: Metadata = { title: "Sales proposals" };

export default function SalesPage() {
	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Sales proposals</PageShellTitle>
					<PageShellDescription>
						An agent reads a customer note and proposes changes. You approve
						them before the CRM records change.
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
