export const CSV_ENTITIES = ["companies", "contacts", "deals"] as const;

export type CsvEntity = (typeof CSV_ENTITIES)[number];

export const FIELD_PREFIX = "field:";

const COMPANY_COLUMNS = [
	"id",
	"name",
	"domain",
	"website",
	"description",
	"industry",
	"city",
	"stateCode",
	"country",
	"phone",
	"email",
	"linkedinUrl",
	"ownerEmail",
	"source",
	"createdAt",
] as const;

const CONTACT_COLUMNS = [
	"id",
	"firstName",
	"lastName",
	"email",
	"phone",
	"title",
	"linkedinUrl",
	"twitterUrl",
	"githubUrl",
	"companyDomain",
	"companyName",
	"ownerEmail",
	"source",
	"createdAt",
] as const;

const DEAL_COLUMNS = [
	"id",
	"name",
	"description",
	"companyDomain",
	"companyName",
	"stage",
	"closedReason",
	"amount",
	"currency",
	"expectedCloseDate",
	"ownerEmail",
	"createdAt",
] as const;

export const CSV_COLUMNS = {
	companies: COMPANY_COLUMNS,
	contacts: CONTACT_COLUMNS,
	deals: DEAL_COLUMNS,
} as const satisfies Record<CsvEntity, readonly string[]>;

export const INFORMATION_COLUMNS = ["id", "source", "createdAt"] as const;

export const COLUMN_ALIASES = {
	companies: {
		"company name": "name",
		"company domain name": "domain",
		"domain name": "domain",
		"website url": "website",
		"phone number": "phone",
		"country/region": "country",
		"linkedin company page": "linkedinUrl",
	},
	contacts: {
		"first name": "firstName",
		"last name": "lastName",
		"email address": "email",
		"phone number": "phone",
		"job title": "title",
		"company domain name": "companyDomain",
		"company name": "companyName",
		"associated company": "companyName",
	},
	deals: {
		"deal name": "name",
		"deal description": "description",
		"deal stage": "stage",
		"close date": "expectedCloseDate",
		"company domain name": "companyDomain",
		"company name": "companyName",
		"associated company": "companyName",
	},
} as const satisfies Record<CsvEntity, Record<string, string>>;

export const REQUIRED_COLUMNS = {
	companies: ["name"],
	contacts: ["firstName", "email"],
	deals: ["name"],
} as const satisfies Record<CsvEntity, readonly string[]>;
