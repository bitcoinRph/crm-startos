"use client";

import { signIn } from "@crm/auth/client";
import { Button } from "@crm/ui/components/button";
import { Field, FieldGroup, FieldLabel } from "@crm/ui/components/field";
import { Input } from "@crm/ui/components/input";
import { Spinner } from "@crm/ui/components/spinner";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

export function PasswordSignIn() {
	const [pending, setPending] = useState(false);

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setPending(true);

		const form = new FormData(event.currentTarget);
		const email = String(form.get("email") ?? "");
		const password = String(form.get("password") ?? "");
		const origin = window.location.origin;

		const { error } = await signIn.email({
			email,
			password,
			callbackURL: `${origin}/`,
		});

		if (error) {
			toast.error(error.message ?? "Could not sign in.");
			setPending(false);
		}
	}

	return (
		<form
			onSubmit={(event) => {
				handleSubmit(event).catch(() => {
					toast.error("Could not reach the sign-in service.");
					setPending(false);
				});
			}}
		>
			<FieldGroup>
				<Field>
					<FieldLabel htmlFor="sign-in-email">Email</FieldLabel>
					<Input
						id="sign-in-email"
						name="email"
						type="email"
						autoComplete="username"
						required
					/>
				</Field>
				<Field>
					<FieldLabel htmlFor="sign-in-password">Password</FieldLabel>
					<Input
						id="sign-in-password"
						name="password"
						type="password"
						autoComplete="current-password"
						required
					/>
				</Field>
				<Button className="w-full" disabled={pending} type="submit">
					{pending ? <Spinner data-icon="inline-start" /> : null}
					Sign in
				</Button>
			</FieldGroup>
		</form>
	);
}
