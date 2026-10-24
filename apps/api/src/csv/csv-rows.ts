import { DealStage } from "@crm/db";
import { isCurrencyCode } from "@crm/db/currency";
import { z } from "zod";
import { normalizeDomain } from "../companies/domain";
import { MAX_AMOUNT_CENTS } from "../deals/deals.contracts";
import { dateCell } from "./csv-export.service";

const STAGE_ALIASES = {
	unqualified: DealStage.UNQUALIFIED_TO_BUY,
	decisionmakerin: DealStage.DECISION_MAKER_BOUGHT_IN,
} as const;

const AMOUNT = /^\d+(\.\d{1,2})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2})?)?$/;

function stageKey(value: string): string {
	return value.toLowerCase().replaceAll(/[^a-z]/g, "");
}

const STAGES = new Map<string, DealStage>([
	...Object.values(DealStage).map((stage) => [stageKey(stage), stage] as const),
	...Object.entries(STAGE_ALIASES),
]);

const STAGE_NAMES = Object.values(DealStage).join(", ");

function parseStage(value: string): DealStage | undefined {
	return STAGES.get(stageKey(value));
}

export function amountCentsOf(amount: string): number {
	return Math.round(Number(amount) * 100);
}

const cell = z
	.string()
	.trim()
	.transform((value) => (value === "" ? undefined : value))
	.optional();

const emailCell = cell
	.refine(
		(value) => value === undefined || z.email().safeParse(value).success,
		"is not an email address.",
	)
	.transform((value) => value?.toLowerCase());

const domainCell = cell
	.refine(
		(value) => value === undefined || normalizeDomain(value) !== null,
		"is not a domain. Try something like stripe.com.",
	)
	.transform((value) => normalizeDomain(value) ?? undefined);

const stageCell = cell
	.refine(
		(value) => value === undefined || parseStage(value) !== undefined,
		`is not a stage. Use one of ${STAGE_NAMES}.`,
	)
	.transform((value) => (value === undefined ? undefined : parseStage(value)));

const amountCell = cell
	.refine(
		(value) => value === undefined || AMOUNT.test(value),
		"is not an amount like 1234.50, without a currency sign or separators.",
	)
	.refine(
		(value) => value === undefined || amountCentsOf(value) <= MAX_AMOUNT_CENTS,
		"is too large to record.",
	)
	.transform((value) =>
		value === undefined ? undefined : Number(value).toFixed(2),
	);

const currencyCell = cell
	.transform((value) => value?.toUpperCase())
	.refine(
		(value) => value === undefined || isCurrencyCode(value),
		"is not a currency this CRM supports.",
	);

const closeDateCell = cell
	.refine(
		(value) =>
			value === undefined ||
			(DATE.test(value) && !Number.isNaN(new Date(value).getTime())),
		"is not a date like 2027-03-31.",
	)
	.transform((value) =>
		value === undefined ? undefined : dateCell(new Date(value)),
	);

export const companyRow = z.object({
	name: z.string().trim().min(1, "is required."),
	domain: domainCell,
	website: cell,
	description: cell,
	industry: cell,
	city: cell,
	stateCode: cell,
	country: cell,
	phone: cell,
	email: cell,
	linkedinUrl: cell,
	ownerEmail: emailCell,
});

export const contactRow = z.object({
	firstName: z.string().trim().min(1, "is required."),
	lastName: cell,
	email: z
		.string()
		.trim()
		.min(1, "is required.")
		.pipe(z.email("is not an email address."))
		.transform((value) => value.toLowerCase()),
	phone: cell,
	title: cell,
	linkedinUrl: cell,
	twitterUrl: cell,
	githubUrl: cell,
	companyDomain: domainCell,
	companyName: cell,
	ownerEmail: emailCell,
});

export const dealRow = z.object({
	name: z.string().trim().min(1, "is required."),
	description: cell,
	companyDomain: domainCell,
	companyName: cell,
	stage: stageCell,
	closedReason: cell,
	amount: amountCell,
	currency: currencyCell,
	expectedCloseDate: closeDateCell,
	ownerEmail: emailCell,
});

export type CompanyRow = z.infer<typeof companyRow>;
export type ContactRow = z.infer<typeof contactRow>;
export type DealRow = z.infer<typeof dealRow>;

export function describeIssues(error: z.ZodError): string {
	return error.issues
		.map((issue) => {
			const column = issue.path.join(".");
			return column ? `${column} ${issue.message}` : issue.message;
		})
		.join(" ");
}
