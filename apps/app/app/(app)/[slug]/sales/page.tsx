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
						Review the changes an agent proposes from a customer note, then
						approve or discard them.
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
