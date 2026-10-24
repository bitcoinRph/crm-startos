export const CSV_ENTITIES = ["companies", "contacts", "deals"] as const;

export type CsvEntity = (typeof CSV_ENTITIES)[number];

export const FIELD_PREFIX = "field:";

export const COMPANY_COLUMNS = [
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

export const CONTACT_COLUMNS = [
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

export const DEAL_COLUMNS = [
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
