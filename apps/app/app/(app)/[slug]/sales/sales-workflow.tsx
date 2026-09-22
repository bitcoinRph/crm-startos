"use client";

import { Alert, AlertDescription, AlertTitle } from "@crm/ui/components/alert";
import { Badge } from "@crm/ui/components/badge";
import { Button } from "@crm/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
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
import { Textarea } from "@crm/ui/components/textarea";
import { approvedSalesProfile } from "@crm/validation/sales";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "api/app-router";
import { useState } from "react";
import { z } from "zod";
import { useTRPC } from "@/lib/trpc/client";
import { SALES_WORKFLOW } from "./sales-workflow-config";

export type SalesRequest = inferRouterOutputs<AppRouter>["sales"]["getRequest"];
const contactRevision = z.object({ updatedAt: z.iso.datetime() });

export function SalesWorkflow() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [contactId, setContactId] = useState("");
	const [selectedId, setSelectedId] = useState("");
	const [source, setSource] = useState("");
	const [requestId, setRequestId] = useState("");
	const contact = useQuery(
		trpc.contacts.byId.queryOptions(
			{ id: selectedId },
			{ enabled: !!selectedId, retry: false },
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
	const error = create.error ?? approve.error ?? request.error ?? contact.error;
	return (
		<div className="flex flex-col gap-6">
			<Alert>
				<AlertTitle>Fixed sales template</AlertTitle>
				<AlertDescription>
					This is not a generic agent. Use synthetic notes only. The worker
					proposes a job title, note, or task. No CRM records change before
					approval.
				</AlertDescription>
			</Alert>
			{error && (
				<Alert variant="destructive">
					<AlertTitle>API error</AlertTitle>
					<AlertDescription>{error.message}</AlertDescription>
				</Alert>
			)}
			{request.error && (
				<Button variant="outline" onClick={() => void request.refetch()}>
					Retry request status
				</Button>
			)}
			{!active && (
				<Card>
					<CardHeader>
						<CardTitle>Prepare a proposal</CardTitle>
						<CardDescription>
							Select one customer and review the current contact revision.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<form
							onSubmit={(event) => {
								event.preventDefault();
								if (
									!revision.success ||
									selectedId !== contactId ||
									!contact.data ||
									contact.data.archivedAt ||
									create.isPending
								)
									return;
								create.mutate({
									source,
									candidateIds: [contact.data.id],
									expectedUpdatedAt: revision.data.updatedAt,
									profileId: approvedSalesProfile.id,
									profileRevision: approvedSalesProfile.revision,
								});
							}}
						>
							<FieldGroup>
								<Field>
									<FieldLabel htmlFor="sales-profile">
										Inference profile
									</FieldLabel>
									<Select value={approvedSalesProfile.id}>
										<SelectTrigger id="sales-profile">
											<SelectValue>
												{approvedSalesProfile.id} /{" "}
												{approvedSalesProfile.revision}
											</SelectValue>
										</SelectTrigger>
										<SelectContent>
											<SelectGroup>
												<SelectItem value={approvedSalesProfile.id}>
													{approvedSalesProfile.id} /{" "}
													{approvedSalesProfile.revision}
												</SelectItem>
											</SelectGroup>
										</SelectContent>
									</Select>
								</Field>
								<Field>
									<FieldLabel htmlFor="sales-contact">Contact ID</FieldLabel>
									<Input
										id="sales-contact"
										required
										value={contactId}
										disabled={create.isPending}
										onChange={(event) => {
											setContactId(event.target.value);
											setSelectedId("");
											create.reset();
										}}
									/>
									<FieldDescription>
										Copy the exact contact ID from the CRM. No automatic
										customer matching.
									</FieldDescription>
								</Field>
								<Button
									type="button"
									variant="outline"
									disabled={
										!contactId || contact.isFetching || create.isPending
									}
									onClick={() => {
										create.reset();
										if (selectedId === contactId) void contact.refetch();
										else setSelectedId(contactId);
									}}
								>
									{contact.isFetching
										? "Loading contact…"
										: "Load contact revision"}
								</Button>
								{contact.data && selectedId === contactId && (
									<Field>
										<FieldLabel htmlFor="sales-revision">
											Expected current contact revision
										</FieldLabel>
										<Input
											id="sales-revision"
											readOnly
											value={revision.success ? revision.data.updatedAt : ""}
										/>
										<FieldDescription>
											Customer: {contact.data.firstName} {contact.data.lastName}{" "}
											· {contact.data.email} · {contact.data.id}. Current title:{" "}
											{contact.data.title ?? "None"}.
										</FieldDescription>
										{!revision.success && (
											<p role="alert">
												The contact API does not provide a valid current
												revision. Submission is disabled.
											</p>
										)}
										{contact.data.archivedAt && (
											<p role="alert">
												This contact is archived. Select an active contact.
											</p>
										)}
									</Field>
								)}
								<Field>
									<FieldLabel htmlFor="sales-source">Synthetic note</FieldLabel>
									<Textarea
										id="sales-source"
										required
										maxLength={SALES_WORKFLOW.sourceMaxLength}
										rows={6}
										value={source}
										disabled={create.isPending}
										onChange={(event) => setSource(event.target.value)}
									/>
									<FieldDescription>
										Evidence and proposed values must match exact text from this
										note.
									</FieldDescription>
								</Field>
								<Button
									type="submit"
									disabled={
										!revision.success ||
										selectedId !== contactId ||
										!contact.data ||
										!!contact.data.archivedAt ||
										!source.trim() ||
										contact.isFetching ||
										create.isPending
									}
								>
									{create.isPending ? "Submitting…" : "Create proposal request"}
								</Button>
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
			{active && request.data && request.data.status !== "PENDING" && (
				<Button
					variant="outline"
					disabled={approve.isPending}
					onClick={() => {
						setRequestId("");
						setSelectedId("");
						create.reset();
						approve.reset();
					}}
				>
					Start another request
				</Button>
			)}
		</div>
	);
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
	return (
		<Card>
			<CardHeader>
				<CardTitle>Proposal review</CardTitle>
				<CardDescription>
					No CRM records change before approval.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="flex flex-col gap-4">
					<div role="status">
						Status: <Badge variant="outline">{request.status}</Badge>
					</div>
					<dl className="grid gap-2 break-words">
						<dt>Request ID</dt>
						<dd>{request.id}</dd>
						<dt>Customer</dt>
						<dd>
							{request.contactSnapshot.firstName}{" "}
							{request.contactSnapshot.lastName} ·{" "}
							{request.contactSnapshot.email}
						</dd>
						<dt>Contact ID</dt>
						<dd>{request.contactId}</dd>
						<dt>Expected contact revision</dt>
						<dd>{request.expectedUpdatedAt}</dd>
						<dt>Current title at request</dt>
						<dd>{request.contactSnapshot.title ?? "None"}</dd>
						<dt>Profile / revision</dt>
						<dd>
							{request.profileId} / {request.profileRevision}
						</dd>
						<dt>Exact source</dt>
						<dd className="whitespace-pre-wrap">{request.source}</dd>
					</dl>
					{request.status === "PENDING" && (
						<p role="status">
							Waiting for the worker. No contact, note, or task writes occur
							while pending.
						</p>
					)}
					{request.error && (
						<Alert variant="destructive">
							<AlertTitle>Worker error</AlertTitle>
							<AlertDescription>{request.error}</AlertDescription>
						</Alert>
					)}
					{proposal?.operations.map((operation) => (
						<Card key={operation.type}>
							<CardHeader>
								<CardTitle>{operation.type}</CardTitle>
								<CardDescription>
									Contact ID: {operation.contactId} · Field:{" "}
									{operation.field ?? "None"}
								</CardDescription>
							</CardHeader>
							<CardContent>
								<dl className="grid gap-2 break-words">
									<dt>Exact value</dt>
									<dd className="whitespace-pre-wrap">{operation.value}</dd>
									<dt>Exact evidence</dt>
									<dd className="whitespace-pre-wrap">{operation.evidence}</dd>
								</dl>
							</CardContent>
						</Card>
					))}
					{proposal && <p>Proposal ID: {proposal.id}</p>}
					{proposal &&
						request.status === "PROPOSED" &&
						!proposal.approvedAt && (
							<Button disabled={approving} onClick={onApprove}>
								{approving ? "Confirming approval…" : "Approve proposal"}
							</Button>
						)}
					{proposal?.approvedAt && (
						<p role="status">
							Approved at {proposal.approvedAt}. Applied activity IDs:{" "}
							{proposal.appliedActivityIds.join(", ") || "None"}.
						</p>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
