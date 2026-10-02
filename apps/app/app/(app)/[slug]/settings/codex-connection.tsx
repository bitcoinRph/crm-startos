"use client";

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
import { EgressBadge } from "@crm/ui/components/egress-badge";
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
import { StatusIndicator } from "@crm/ui/components/status-indicator";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";

const SECOND_MS = 1000;

type SignIn = {
	verificationUrl: string;
	userCode: string;
	expiresAt: string;
	intervalSeconds: number;
};

export function CodexConnection() {
	const trpc = useTRPC();
	const status = useQuery(trpc.codex.status.queryOptions());

	if (!status.data) return null;
	const codex = status.data;

	return (
		<Card>
			<CardHeader>
				<CardTitle>Codex (your ChatGPT plan)</CardTitle>
				<CardDescription>
					Sign in with your own ChatGPT account so your research conversations
					and the sales requests you file on the crm-codex profile run on Codex
					models. Only you use your connection. Ollama keeps working as before.
				</CardDescription>
				{codex.connected && codex.state === "ACTIVE" && codex.modelId ? (
					<CardAction>
						<EgressBadge
							destination="OpenAI"
							detail={`New conversations you start, and your crm-codex sales requests, go to OpenAI on ${codex.modelId}.`}
						/>
					</CardAction>
				) : null}
			</CardHeader>
			<CardContent>
				{!codex.available ? (
					<p className="text-muted-foreground text-sm">
						Codex is off on this install. The deployment administrator sets
						CRM_SECRETS_KEY, which encrypts every stored credential. StartOS
						sets it for you.
					</p>
				) : codex.connected ? (
					<Connected />
				) : (
					<NotConnected />
				)}
			</CardContent>
		</Card>
	);
}

function NotConnected() {
	const trpc = useTRPC();
	const cache = useCrmCache();
	const keyId = useId();
	const [signIn, setSignIn] = useState<SignIn | null>(null);
	const [apiKey, setApiKey] = useState("");

	const start = useMutation(
		trpc.codex.startSignIn.mutationOptions({
			onSuccess: setSignIn,
			onError: (error) => toast.error(error.message),
		}),
	);

	const poll = useMutation(
		trpc.codex.pollSignIn.mutationOptions({
			onSuccess: async (outcome) => {
				if (outcome.state === "pending") return;
				setSignIn(null);
				if (outcome.state === "connected") {
					toast.success("ChatGPT connected. Choose a model next.");
					await cache.codex();
				} else if (outcome.state === "expired")
					toast.error("The sign-in code expired. Start again.");
				else toast.error(outcome.reason);
			},
			onError: (error) => {
				setSignIn(null);
				toast.error(error.message);
			},
		}),
	);

	const connectKey = useMutation(
		trpc.codex.connectApiKey.mutationOptions({
			onSuccess: async () => {
				setApiKey("");
				toast.success("OpenAI API key connected. Choose a model next.");
				await cache.codex();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const { mutate: pollOnce, isPending: polling } = poll;
	useEffect(() => {
		if (!signIn || polling) return;
		const timer = setTimeout(
			() => pollOnce(),
			signIn.intervalSeconds * SECOND_MS,
		);
		return () => clearTimeout(timer);
	}, [signIn, polling, pollOnce]);

	return (
		<FieldGroup>
			{signIn ? (
				<Field>
					<FieldLabel>Enter this code at OpenAI</FieldLabel>
					<p className="font-mono text-lg">{signIn.userCode}</p>
					<FieldDescription>
						Open{" "}
						<a
							href={signIn.verificationUrl}
							target="_blank"
							rel="noreferrer"
							className="underline underline-offset-4 hover:text-foreground"
						>
							{signIn.verificationUrl}
						</a>
						, sign in to ChatGPT and enter the code. It expires at{" "}
						{new Date(signIn.expiresAt).toLocaleTimeString()}. This page
						finishes by itself.
					</FieldDescription>
					<div className="flex items-center gap-2">
						<Spinner />
						<span className="text-muted-foreground text-xs">
							Waiting for OpenAI
						</span>
					</div>
				</Field>
			) : (
				<Field>
					<FieldLabel>ChatGPT account</FieldLabel>
					<FieldDescription>
						Uses the same device sign-in as the Codex CLI. If OpenAI refuses,
						turn on device code login in your ChatGPT security settings.
					</FieldDescription>
					<div>
						<Button onClick={() => start.mutate()} disabled={start.isPending}>
							{start.isPending ? <Spinner data-icon="inline-start" /> : null}
							Connect ChatGPT
						</Button>
					</div>
				</Field>
			)}

			<form
				onSubmit={(event) => {
					event.preventDefault();
					connectKey.mutate({ apiKey: apiKey.trim() });
				}}
			>
				<Field>
					<FieldLabel htmlFor={keyId}>Or an OpenAI API key</FieldLabel>
					<div className="flex items-center gap-2">
						<Input
							id={keyId}
							type="password"
							value={apiKey}
							onChange={(event) => setApiKey(event.target.value)}
							placeholder="sk-…"
							autoComplete="off"
							autoCapitalize="off"
							autoCorrect="off"
							spellCheck={false}
							disabled={connectKey.isPending}
						/>
						<Button
							type="submit"
							variant="outline"
							disabled={connectKey.isPending || apiKey.trim() === ""}
						>
							{connectKey.isPending ? (
								<Spinner data-icon="inline-start" />
							) : null}
							Connect key
						</Button>
					</div>
					<FieldDescription>
						Billed per token on your OpenAI Platform account instead of your
						ChatGPT plan.
					</FieldDescription>
				</Field>
			</form>
		</FieldGroup>
	);
}

function Connected() {
	const trpc = useTRPC();
	const cache = useCrmCache();
	const windowId = useId();
	const status = useQuery(trpc.codex.status.queryOptions());
	const models = useQuery(trpc.codex.models.queryOptions());
	const [pending, setPending] = useState<string | null>(null);
	const [contextWindow, setContextWindow] = useState("");

	const setModel = useMutation(
		trpc.codex.setModel.mutationOptions({
			onSuccess: async () => {
				setPending(null);
				setContextWindow("");
				toast.success("New conversations will use this model.");
				await cache.codex();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const disconnect = useMutation(
		trpc.codex.disconnect.mutationOptions({
			onSuccess: async () => {
				toast.success("Codex disconnected.");
				await cache.codex();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	if (!status.data) return null;
	const codex = status.data;
	const catalog = models.data?.models ?? [];
	const chosen = catalog.find((model) => model.id === pending);
	const needsWindow =
		chosen !== undefined && chosen.contextWindowTokens === null;
	const reconnect = codex.state === "NEEDS_RECONNECT";

	return (
		<FieldGroup>
			<div className="flex items-center justify-between gap-3">
				<DescriptionList>
					<DescriptionTerm>Connected as</DescriptionTerm>
					<DescriptionDetails>{codex.label}</DescriptionDetails>
					{codex.planType ? (
						<>
							<DescriptionTerm>Plan</DescriptionTerm>
							<DescriptionDetails>{codex.planType}</DescriptionDetails>
						</>
					) : null}
					{codex.connectedAt ? (
						<>
							<DescriptionTerm>Since</DescriptionTerm>
							<DescriptionDetails>
								{new Date(codex.connectedAt).toLocaleString()}
							</DescriptionDetails>
						</>
					) : null}
				</DescriptionList>
				<StatusIndicator
					size="sm"
					tone={reconnect ? "warning" : "success"}
					label={reconnect ? "Reconnect needed" : "Connected"}
				/>
			</div>

			{reconnect ? (
				<p className="text-muted-foreground text-sm">
					{codex.lastError ?? "OpenAI ended this sign-in."} Disconnect, then
					connect again.
				</p>
			) : (
				<Field>
					<FieldLabel>Model</FieldLabel>
					<Select
						value={pending ?? codex.modelId ?? undefined}
						onValueChange={(id) => {
							const model = catalog.find((entry) => entry.id === id);
							if (model?.contextWindowTokens === null) setPending(id);
							else setModel.mutate({ modelId: id, contextWindowTokens: null });
						}}
						disabled={models.isPending || setModel.isPending}
					>
						<SelectTrigger>
							<SelectValue placeholder="Choose a model" />
						</SelectTrigger>
						<SelectContent>
							<SelectGroup>
								{catalog.map((model) => (
									<SelectItem key={model.id} value={model.id}>
										{model.name}
									</SelectItem>
								))}
							</SelectGroup>
						</SelectContent>
					</Select>
					<FieldDescription>
						{models.data && !models.data.available
							? models.data.reason
							: codex.modelId
								? `${codex.modelId} · ${codex.modelContextWindowTokens?.toLocaleString()} token context. Conversations already open keep the model they started with.`
								: "No model chosen yet. Conversations keep using the deployment's inference mode until you choose one."}
					</FieldDescription>
				</Field>
			)}

			{needsWindow ? (
				<form
					onSubmit={(event) => {
						event.preventDefault();
						setModel.mutate({
							modelId: chosen.id,
							contextWindowTokens: Number.parseInt(contextWindow, 10),
						});
					}}
				>
					<Field>
						<FieldLabel htmlFor={windowId}>Context window in tokens</FieldLabel>
						<div className="flex items-center gap-2">
							<Input
								id={windowId}
								inputMode="numeric"
								value={contextWindow}
								onChange={(event) => setContextWindow(event.target.value)}
								placeholder="128000"
							/>
							<Button
								type="submit"
								variant="outline"
								disabled={setModel.isPending || !/^\d+$/.test(contextWindow)}
							>
								Use this model
							</Button>
						</div>
						<FieldDescription>
							OpenAI's model list does not publish this for API keys. Use the
							value from the model's documentation.
						</FieldDescription>
					</Field>
				</form>
			) : null}

			<div>
				<Button
					variant="outline"
					onClick={() => disconnect.mutate()}
					disabled={disconnect.isPending}
				>
					{disconnect.isPending ? <Spinner data-icon="inline-start" /> : null}
					Disconnect
				</Button>
			</div>
		</FieldGroup>
	);
}
