"use client";

import { Alert, AlertDescription, AlertTitle } from "@crm/ui/components/alert";
import { Button } from "@crm/ui/components/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import {
	DescriptionDetails,
	DescriptionList,
	DescriptionTerm,
} from "@crm/ui/components/description-list";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@crm/ui/components/field";
import { Input } from "@crm/ui/components/input";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@crm/ui/components/select";
import { Spinner } from "@crm/ui/components/spinner";
import {
	StatusIndicator,
	type StatusTone,
} from "@crm/ui/components/status-indicator";
import { Textarea } from "@crm/ui/components/textarea";
import {
	approvedSalesProfile,
	SALES_PROFILES,
	type SalesOperation,
	type SalesProfile,
} from "@crm/validation/sales";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "api/app-router";
import { parseAsString, useQueryState } from "nuqs";
import { useState } from "react";
import { z } from "zod";
import { ContactPicker } from "@/components/crm/contact-picker";
import { LocalDateTime } from "@/components/local-date-time";
import { useTRPC } from "@/lib/trpc/client";
import { SALES_WORKFLOW } from "./sales-workflow-config";

export type SalesRequest = inferRouterOutputs<AppRouter>["sales"]["getRequest"];
type SalesStatus = SalesRequest["status"];
const contactRevision = z.object({ updatedAt: z.iso.datetime() });

const STATUS = {
	PENDING: { label: "Waiting for the agent", tone: "neutral", busy: true },
	PROPOSED: { label: "Ready for your review", tone: "primary", busy: false },
	APPROVED: { label: "Approved", tone: "success", busy: false },
	FAILED: { label: "Failed", tone: "error", busy: false },
} as const satisfies Record<
	SalesStatus,
	{ label: string; tone: StatusTone; busy: boolean }
>;

const OPERATION_LABEL = {
	contact_fact: "Update a contact field",
	create_note: "Add a note",
	create_task: "Add a task",
} as const satisfies Record<SalesOperation["type"], string>;

const DATE_TIME = { dateStyle: "medium", timeStyle: "short" } as const;

function fullName(person: { firstName: string; lastName: string | null }) {
	return [person.firstName, person.lastName].filter(Boolean).join(" ");
}

export function SalesWorkflow() {
	const [requestId, setRequestId] = useQueryState(
		"requestId",
		parseAsString.withDefault(""),
	);
	return (
		<SalesWorkflowContent
			key={requestId}
			requestId={requestId}
			setRequestId={(id) => void setRequestId(id || null)}
		/>
	);
}

function SalesWorkflowContent({
	requestId,
	setRequestId,
}: {
	requestId: string;
	setRequestId: (id: string) => void;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [contactId, setContactId] = useQueryState(
		"contactId",
		parseAsString.withDefault(""),
	);
	const [profile, setProfile] = useState<SalesProfile>(approvedSalesProfile);
	const [source, setSource] = useState("");
	const [requestToOpen, setRequestToOpen] = useState("");
	const contact = useQuery(
		trpc.contacts.byId.queryOptions(
			{ id: contactId },
			{ enabled: !!contactId, retry: false },
		),
	);
	const revision = contactRevision.safeParse(contact.data);
	const request = useQuery(
		trpc.sales.getRequest.queryOptions(
			{ requestId },
			{
				enabled: !!requestId,
				retry: false,
				refetchInterval: (query) =>
					!query.state.error &&
					(!query.state.data || query.state.data.status === "PENDING")
						? SALES_WORKFLOW.pollIntervalMs
						: false,
			},
		),
	);
	const create = useMutation(
		trpc.sales.createRequest.mutationOptions({
			onSuccess: (result) => {
				queryClient.setQueryData(
					trpc.sales.getRequest.queryKey({ requestId: result.id }),
					result,
				);
				setRequestId(result.id);
			},
		}),
	);
	const approve = useMutation(
		trpc.sales.approveProposal.mutationOptions({
			onSuccess: async () => {
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: trpc.sales.getRequest.queryKey({ requestId }),
					}),
					queryClient.invalidateQueries({ queryKey: trpc.contacts.pathKey() }),
				]);
			},
		}),
	);
	const active = !!requestId;
	const busy = create.isPending || approve.isPending;
	const error = create.error ?? approve.error ?? request.error ?? contact.error;
	const loaded = contact.data && contact.data.id === contactId;
	const canSubmit =
		revision.success &&
		!!loaded &&
		!contact.data?.archivedAt &&
		!!source.trim() &&
		!contact.isFetching &&
		!create.isPending;

	return (
		<div className="flex max-w-3xl flex-col gap-6">
			{error && (
				<Alert variant="destructive" role="alert">
					<AlertTitle>The CRM refused the request</AlertTitle>
					<AlertDescription>{error.message}</AlertDescription>
				</Alert>
			)}
			{request.error && (
				<div>
					<Button variant="outline" onClick={() => void request.refetch()}>
						Retry request status
					</Button>
				</div>
			)}
			{!active && (
				<Card>
					<CardHeader>
						<CardTitle>Prepare a proposal</CardTitle>
						<CardDescription>
							Choose one contact and paste one customer note. An agent proposes
							a job title, a note or a task, quoted from that note. Nothing in
							the CRM changes until you approve it.
						</CardDescription>
						<CardAction>
							<Button type="submit" form="sales-prepare" disabled={!canSubmit}>
								{create.isPending ? <Spinner data-icon="inline-start" /> : null}
								Create proposal request
							</Button>
						</CardAction>
					</CardHeader>
					<CardContent>
						<form
							id="sales-prepare"
							onSubmit={(event) => {
								event.preventDefault();
								if (!canSubmit || !revision.success || !contact.data) return;
								create.mutate({
									source,
									candidateIds: [contact.data.id],
									expectedUpdatedAt: revision.data.updatedAt,
									profileId: profile.id,
									profileRevision: profile.revision,
								});
							}}
						>
							<FieldGroup>
								<Field>
									<FieldLabel htmlFor="sales-contact">Contact</FieldLabel>
									<ContactPicker
										id="sales-contact"
										value={contactId}
										disabled={create.isPending}
										selected={
											loaded && contact.data
												? {
														value: contact.data.id,
														label: fullName(contact.data),
														hint: contact.data.email ?? undefined,
													}
												: undefined
										}
										onValueChange={(id) => {
											create.reset();
											void setContactId(id || null);
										}}
									/>
									<FieldDescription aria-live="polite">
										{!contactId ? (
											"Search by name or email. The CRM does no automatic customer matching."
										) : contact.isFetching ? (
											<span className="inline-flex items-center gap-2">
												<Spinner />
												Loading the contact…
											</span>
										) : loaded && contact.data ? (
											`${contact.data.email ?? "No email"} · Current title: ${contact.data.title ?? "None"}.`
										) : null}
									</FieldDescription>
									{loaded && !revision.success && (
										<Alert variant="destructive">
											<AlertDescription>
												The contact API does not provide a valid current
												revision. Submission is disabled.
											</AlertDescription>
										</Alert>
									)}
									{loaded && contact.data?.archivedAt && (
										<Alert variant="destructive">
											<AlertDescription>
												This contact is archived. Choose an active contact.
											</AlertDescription>
										</Alert>
									)}
								</Field>
								<Field>
									<FieldLabel htmlFor="sales-source">Customer note</FieldLabel>
									<Textarea
										id="sales-source"
										required
										maxLength={SALES_WORKFLOW.sourceMaxLength}
										rows={6}
										value={source}
										disabled={create.isPending}
										onChange={(event) => setSource(event.target.value)}
										placeholder="Spoke with Dana today. She is now Head of Procurement and wants a call on Friday."
									/>
									<FieldDescription>
										Every proposed value must quote exact text from this note.{" "}
										<span className="tabular-nums">
											{source.length} of {SALES_WORKFLOW.sourceMaxLength}{" "}
											characters.
										</span>
									</FieldDescription>
								</Field>
								<Field>
									<FieldLabel htmlFor="sales-profile">Processed by</FieldLabel>
									<Select
										value={profile.id}
										onValueChange={(id) =>
											setProfile(
												SALES_PROFILES.find((entry) => entry.id === id) ??
													approvedSalesProfile,
											)
										}
										disabled={create.isPending}
									>
										<SelectTrigger id="sales-profile">
											<SelectValue>{profile.label}</SelectValue>
										</SelectTrigger>
										<SelectContent>
											<SelectGroup>
												{SALES_PROFILES.map((entry) => (
													<SelectItem key={entry.id} value={entry.id}>
														{entry.label}
													</SelectItem>
												))}
											</SelectGroup>
										</SelectContent>
									</Select>
									<FieldDescription>
										Profile {profile.id} / {profile.revision}.
									</FieldDescription>
								</Field>
							</FieldGroup>
						</form>
					</CardContent>
				</Card>
			)}
			{request.data && (
				<SalesRequestReview
					request={request.data}
					approving={approve.isPending || approve.isSuccess || request.isError}
					onApprove={() => {
						const proposal = request.data?.proposal;
						if (proposal && !approve.isPending && !approve.isSuccess)
							approve.mutate({
								proposalId: proposal.id,
								idempotencyKey: proposal.idempotencyKey,
							});
					}}
				/>
			)}
			{active && (
				<div>
					<Button
						variant="outline"
						disabled={approve.isPending}
						onClick={() => {
							setRequestId("");
							create.reset();
							approve.reset();
						}}
					>
						Start another request
					</Button>
				</div>
			)}
			<form
				className="flex flex-col gap-2 border-t pt-6"
				onSubmit={(event) => {
					event.preventDefault();
					if (!requestToOpen.trim() || busy) return;
					setRequestId(requestToOpen.trim());
				}}
			>
				<Field>
					<FieldLabel htmlFor="sales-open-request">
						Open a request by its ID
					</FieldLabel>
					<div className="flex items-center gap-2">
						<Input
							id="sales-open-request"
							required
							value={requestToOpen}
							onChange={(event) => setRequestToOpen(event.target.value)}
							disabled={busy}
							placeholder="00000000-0000-4000-8000-000000000000"
							autoComplete="off"
							spellCheck={false}
						/>
						<Button
							type="submit"
							variant="outline"
							disabled={!requestToOpen.trim() || busy}
						>
							Open request
						</Button>
					</div>
					<FieldDescription>
						An agent returns this ID when it files a request. A link with
						?requestId= opens the same view.
					</FieldDescription>
				</Field>
			</form>
		</div>
	);
}

function OperationTarget({ operation }: { operation: SalesOperation }) {
	if (operation.type === "contact_fact")
		return (
			<>
				Field <span className="font-mono">{operation.field}</span>
			</>
		);
	return <>On the contact timeline</>;
}

export function SalesRequestReview({
	request,
	approving,
	onApprove,
}: {
	request: SalesRequest;
	approving: boolean;
	onApprove: () => void;
}) {
	const proposal = request.proposal;
	const status = STATUS[request.status];
	const canApprove =
		!!proposal && request.status === "PROPOSED" && !proposal.approvedAt;

	return (
		<Card data-slot="sales-request" data-status={request.status}>
			<CardHeader>
				<CardTitle>Proposal for {fullName(request.contactSnapshot)}</CardTitle>
				<CardDescription>
					{request.contactSnapshot.email ?? "No email"} · Current title:{" "}
					{request.contactSnapshot.title ?? "None"}. No CRM records change
					before approval.
				</CardDescription>
				<CardAction>
					<div role="status" aria-live="polite">
						<StatusIndicator
							size="sm"
							tone={status.tone}
							busy={status.busy}
							label={status.label}
						/>
					</div>
				</CardAction>
			</CardHeader>
			<CardContent>
				<div className="flex flex-col gap-6">
					<section className="flex flex-col gap-2">
						<h3 className="font-medium text-sm">Customer note</h3>
						<blockquote className="whitespace-pre-wrap break-words rounded-md bg-muted/40 px-3 py-2 text-sm">
							{request.source}
						</blockquote>
					</section>

					{request.status === "PENDING" && (
						<p className="text-muted-foreground text-sm">
							Waiting for an agent to file a proposal. No contact, note or task
							changes while the request waits. This page updates by itself.
						</p>
					)}

					{request.error && (
						<Alert variant="destructive">
							<AlertTitle>Agent error</AlertTitle>
							<AlertDescription>{request.error}</AlertDescription>
						</Alert>
					)}

					{proposal && proposal.operations.length > 0 && (
						<section className="flex flex-col gap-2">
							<h3 className="font-medium text-sm">Proposed changes</h3>
							<ol className="flex flex-col gap-2">
								{proposal.operations.map((operation) => (
									<li
										key={`${operation.type}-${operation.value}`}
										data-operation={operation.type}
										className="flex flex-col gap-2 rounded-lg border p-3"
									>
										<div className="flex flex-wrap items-baseline justify-between gap-2">
											<span className="font-medium text-sm">
												{OPERATION_LABEL[operation.type]}
											</span>
											<span className="text-muted-foreground text-xs">
												<OperationTarget operation={operation} />
											</span>
										</div>
										<DescriptionList>
											<DescriptionTerm>Exact value</DescriptionTerm>
											<DescriptionDetails>{operation.value}</DescriptionDetails>
											<DescriptionTerm>Exact evidence</DescriptionTerm>
											<DescriptionDetails>
												{operation.evidence}
											</DescriptionDetails>
										</DescriptionList>
									</li>
								))}
							</ol>
						</section>
					)}

					{canApprove && (
						<div>
							<Button disabled={approving} onClick={onApprove}>
								{approving ? <Spinner data-icon="inline-start" /> : null}
								{approving ? "Confirming approval…" : "Approve proposal"}
							</Button>
						</div>
					)}

					{proposal?.approvedAt && (
						<p role="status" className="text-sm">
							Approved{" "}
							<LocalDateTime date={proposal.approvedAt} options={DATE_TIME} />.
							Applied activity IDs:{" "}
							{proposal.appliedActivityIds.join(", ") || "None"}.
						</p>
					)}

					<section className="flex flex-col gap-2 border-t pt-4">
						<h3 className="text-muted-foreground text-xs">Details</h3>
						<DescriptionList size="sm">
							<DescriptionTerm>Request ID</DescriptionTerm>
							<DescriptionDetails mono>{request.id}</DescriptionDetails>
							<DescriptionTerm>Contact ID</DescriptionTerm>
							<DescriptionDetails mono>{request.contactId}</DescriptionDetails>
							<DescriptionTerm>Expected contact revision</DescriptionTerm>
							<DescriptionDetails mono>
								{request.expectedUpdatedAt}
							</DescriptionDetails>
							<DescriptionTerm>Contract</DescriptionTerm>
							<DescriptionDetails mono>
								{request.profileId} / {request.profileRevision}
							</DescriptionDetails>
							<DescriptionTerm>Requested with</DescriptionTerm>
							<DescriptionDetails>
								{request.requestedByKeyId
									? `API key ${request.requestedByKeyId}`
									: "Browser session"}
							</DescriptionDetails>
							{proposal && (
								<>
									<DescriptionTerm>Proposal ID</DescriptionTerm>
									<DescriptionDetails mono>{proposal.id}</DescriptionDetails>
									<DescriptionTerm>Produced by</DescriptionTerm>
									<DescriptionDetails>
										{proposal.producedBy ?? "Unknown"}
									</DescriptionDetails>
									<DescriptionTerm>Filed with</DescriptionTerm>
									<DescriptionDetails>
										{proposal.proposedByKeyId
											? `API key ${proposal.proposedByKeyId}`
											: "Browser session"}
									</DescriptionDetails>
								</>
							)}
						</DescriptionList>
					</section>
				</div>
			</CardContent>
		</Card>
	);
}
