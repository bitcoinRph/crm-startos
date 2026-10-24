import { appUrl } from "@crm/auth";
import { Button } from "@crm/ui/components/button";
import { Markdown } from "@crm/ui/components/markdown";
import { headers } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";
import { requireSession } from "@/lib/session";
import { ConnectionPage, ConnectionPageLoading } from "../connection-page";
import { intakeCurl, intakeEndpoint, intakeOrigin } from "./intake-example";

export default function IntakeConnectionPage(
	props: PageProps<"/[slug]/settings/connections/intake">,
) {
	return (
		<Suspense fallback={<ConnectionPageLoading />}>
			<IntakeConnectionPageContent {...props} />
		</Suspense>
	);
}

async function IntakeConnectionPageContent({
	params,
}: PageProps<"/[slug]/settings/connections/intake">) {
	await requireSession();
	const { slug } = await params;
	const origin = intakeOrigin(await headers(), appUrl);

	return (
		<ConnectionPage>
			<header className="flex flex-col gap-3 px-(--spacing-block-inline)">
				<h1 className="font-medium text-xl">Intake endpoint</h1>
				<p className="text-muted-foreground text-sm leading-relaxed">
					Send a lead from a website form, an automation or a payment hook. The
					CRM finds the contact by email or creates it, logs the message as a
					note and queues research.
				</p>
			</header>
			<section className="flex flex-col gap-3 border-t px-(--spacing-block-inline) pt-5">
				<h2 className="font-medium text-sm">1. Create a key</h2>
				<p className="text-muted-foreground text-xs leading-relaxed">
					Create an API key with the Intake profile. That key can create leads.
					It cannot read or change anything else in the CRM.
				</p>
				<div>
					<Button asChild variant="outline">
						<Link href={`/${slug}/settings/api-keys`}>Open API keys</Link>
					</Button>
				</div>
			</section>
			<section className="flex flex-col gap-3 border-t px-(--spacing-block-inline) pt-5">
				<h2 className="font-medium text-sm">2. Send the lead</h2>
				<p className="text-muted-foreground text-xs leading-relaxed">
					POST JSON to {intakeEndpoint(origin)} with the key as a bearer token.
					Only email is required. You can also send firstName, lastName,
					companyName, companyDomain, message and source.
				</p>
				<Markdown>{`\`\`\`sh\n${intakeCurl(origin)}\n\`\`\``}</Markdown>
			</section>
			<section className="flex flex-col gap-3 border-t px-(--spacing-block-inline) pt-5">
				<h2 className="font-medium text-sm">3. Read the answer</h2>
				<p className="text-muted-foreground text-xs leading-relaxed">
					The CRM answers with the contact id and whether the contact is new. A
					second lead with the same email adds a note to the same contact. An
					address that a rep deleted is not created again. The CRM answers
					suppressed and stores nothing.
				</p>
			</section>
		</ConnectionPage>
	);
}
