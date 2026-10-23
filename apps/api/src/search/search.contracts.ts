import { z } from "zod";
import { SEARCH } from "./search-config";

export const resolveCustomerInput = z
	.strictObject(
		{
			email: z.string().max(SEARCH.resolve.maxEmailLength).optional(),
			domain: z.string().max(SEARCH.resolve.maxDomainLength).optional(),
			archived: z.boolean().default(false),
		},
		{ error: "Pass exactly one email or domain. Use search_crm for names." },
	)
	.refine(
		(input) => (input.email !== undefined) !== (input.domain !== undefined),
		{
			message: "Pass exactly one email or domain. Use search_crm for names.",
		},
	);

export type ResolveCustomerInput = z.infer<typeof resolveCustomerInput>;

const contactMatch = z.object({
	kind: z.literal("contact"),
	matchType: z.enum(["exact", "case_insensitive"]),
	id: z.string(),
	firstName: z.string(),
	lastName: z.string().nullable(),
	email: z.string().nullable(),
	companyId: z.string().nullable(),
	archivedAt: z.string().nullable(),
});

const companyMatch = z.object({
	kind: z.literal("company"),
	matchType: z.literal("exact"),
	id: z.string(),
	name: z.string(),
	domain: z.string().nullable(),
	archivedAt: z.string().nullable(),
});

export const customerContactRows = z.array(
	contactMatch
		.omit({ kind: true, matchType: true })
		.extend({ archivedAt: z.date().nullable() }),
);

export const resolveCustomerOutput = z.object({
	status: z.enum(["resolved", "ambiguous", "not_found", "invalid"]),
	matches: z.array(z.discriminatedUnion("kind", [contactMatch, companyMatch])),
	truncated: z.boolean(),
});

export type ResolveCustomerResult = z.infer<typeof resolveCustomerOutput>;
