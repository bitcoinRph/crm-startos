import { z } from "zod";
import { INTAKE } from "./intake-config";

export const intakeSubmitInput = z.object({
	email: z.email("That is not an email address.").max(INTAKE.email.maxLength),
	firstName: z.string().trim().max(INTAKE.name.maxLength).optional(),
	lastName: z.string().trim().max(INTAKE.name.maxLength).optional(),
	companyName: z.string().trim().max(INTAKE.name.maxLength).optional(),
	companyDomain: z.string().trim().max(INTAKE.domain.maxLength).optional(),
	message: z.string().trim().max(INTAKE.message.maxLength).optional(),
	source: z.string().trim().max(INTAKE.source.maxLength).optional(),
});

export type IntakeSubmitInput = z.infer<typeof intakeSubmitInput>;

export const intakeSubmitOutput = z.object({
	status: z.enum(["accepted", "suppressed"]),
	contactId: z.string().nullable(),
	created: z.boolean(),
});

export type IntakeSubmitOutput = z.infer<typeof intakeSubmitOutput>;
