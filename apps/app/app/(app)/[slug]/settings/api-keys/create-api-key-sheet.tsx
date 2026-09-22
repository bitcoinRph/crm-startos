"use client";

import Add from "@carbon/icons-react/es/Add";
import { Button } from "@crm/ui/components/button";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@crm/ui/components/field";
import { Icon } from "@crm/ui/components/icon";
import { Input } from "@crm/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@crm/ui/components/select";
import {
	Sheet,
	SheetClose,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@crm/ui/components/sheet";
import { Spinner } from "@crm/ui/components/spinner";
import { useMutation } from "@tanstack/react-query";
import { parseAsBoolean, useQueryState } from "nuqs";
import { type ComponentProps, Suspense, useId, useState } from "react";
import { toast } from "sonner";
import { SEARCH_PARAM } from "@/lib/search-param-keys";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";
import {
	API_KEY_PROFILE_OPTIONS,
	type ApiKeyProfileValue,
	DEFAULT_API_KEY_PROFILE,
} from "./api-key-profiles";
import { CreatedApiKeyDialog } from "./created-api-key-dialog";

const FORM = "create-api-key";

const EXPIRATION_OPTIONS = [
	{ value: "30", label: "30 days" },
	{ value: "90", label: "90 days" },
	{ value: "365", label: "1 year" },
	{ value: "never", label: "No expiration" },
] as const;

type ExpirationValue = (typeof EXPIRATION_OPTIONS)[number]["value"];

type CreatedApiKey = RouterOutputs["apiKeys"]["create"];

function NewApiKeyButton(props: ComponentProps<typeof Button>) {
	return (
		<Button {...props}>
			<Icon icon={Add} data-icon="inline-start" />
			New API key
		</Button>
	);
}

export function CreateApiKeySheet() {
	return (
		<Suspense fallback={<NewApiKeyButton disabled />}>
			<CreateApiKeyForm />
		</Suspense>
	);
}

function CreateApiKeyForm() {
	const trpc = useTRPC();
	const cache = useCrmCache();

	const nameId = useId();
	const profileId = useId();
	const expirationId = useId();

	const [open, setOpen] = useQueryState(
		SEARCH_PARAM.dialog.create,
		parseAsBoolean.withDefault(false),
	);
	const [name, setName] = useState("");
	const [profile, setProfile] = useState<ApiKeyProfileValue>(
		DEFAULT_API_KEY_PROFILE,
	);
	const [expiration, setExpiration] = useState<ExpirationValue>("90");
	const [created, setCreated] = useState<CreatedApiKey | null>(null);

	const selectedProfile =
		API_KEY_PROFILE_OPTIONS.find((option) => option.value === profile) ??
		API_KEY_PROFILE_OPTIONS[0];

	const create = useMutation(
		trpc.apiKeys.create.mutationOptions({
			onSuccess: async (apiKey) => {
				await cache.apiKeys();
				await setOpen(null);
				setName("");
				setProfile(DEFAULT_API_KEY_PROFILE);
				setExpiration("90");
				setCreated(apiKey);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	return (
		<>
			<Sheet open={open} onOpenChange={(next) => setOpen(next || null)}>
				<SheetTrigger asChild>
					<NewApiKeyButton />
				</SheetTrigger>

				<SheetContent side="right">
					<SheetHeader>
						<SheetTitle>New API key</SheetTitle>
						<SheetDescription>
							Acts as you, within the access you choose here.
						</SheetDescription>
					</SheetHeader>

					<form
						id={FORM}
						className="flex-1 overflow-y-auto px-4"
						onSubmit={(event) => {
							event.preventDefault();
							create.mutate({
								name: name.trim(),
								profile,
								expiresInDays:
									expiration === "never" ? null : Number(expiration),
							});
						}}
					>
						<FieldGroup>
							<Field>
								<FieldLabel htmlFor={nameId}>Name</FieldLabel>
								<Input
									id={nameId}
									value={name}
									onChange={(event) => setName(event.target.value)}
									placeholder="hermes"
									maxLength={64}
									autoComplete="off"
									autoCapitalize="off"
									autoCorrect="off"
									spellCheck={false}
									required
								/>
								<FieldDescription>
									Which agent or system holds it, so you can revoke the right
									one later.
								</FieldDescription>
							</Field>

							<Field>
								<FieldLabel htmlFor={profileId}>Access</FieldLabel>
								<Select
									value={profile}
									onValueChange={(value) =>
										setProfile(value as ApiKeyProfileValue)
									}
								>
									<SelectTrigger id={profileId} className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{API_KEY_PROFILE_OPTIONS.map((option) => (
											<SelectItem key={option.value} value={option.value}>
												{option.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<FieldDescription>
									{selectedProfile.description}
								</FieldDescription>
							</Field>

							<Field>
								<FieldLabel htmlFor={expirationId}>Expires</FieldLabel>
								<Select
									value={expiration}
									onValueChange={(value) =>
										setExpiration(value as ExpirationValue)
									}
								>
									<SelectTrigger id={expirationId} className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{EXPIRATION_OPTIONS.map((option) => (
											<SelectItem key={option.value} value={option.value}>
												{option.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</Field>
						</FieldGroup>
					</form>

					<SheetFooter>
						<Button
							type="submit"
							form={FORM}
							disabled={!name.trim() || create.isPending}
						>
							{create.isPending ? <Spinner /> : null}
							Create key
						</Button>
						<SheetClose asChild>
							<Button variant="outline">Cancel</Button>
						</SheetClose>
					</SheetFooter>
				</SheetContent>
			</Sheet>

			<CreatedApiKeyDialog
				apiKey={created}
				onOpenChange={(next) => {
					if (!next) setCreated(null);
				}}
			/>
		</>
	);
}
