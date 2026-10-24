import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";
import { db, RecordSource } from "@crm/db";
import { BadRequestException } from "@nestjs/common";
import { AgentQueueService } from "../src/agent/agent-queue.service";
import type { AgentTriggerService } from "../src/agent/agent-trigger.service";
import {
	type ApiKeyProfile,
	KEY_PERMISSIONS,
} from "../src/api-keys/api-key-profiles";
import { CompaniesService } from "../src/companies/companies.service";
import { CompanyDirectoryService } from "../src/companies/company-directory.service";
import type { FaviconService } from "../src/companies/favicon.service";
import { ContactsService } from "../src/contacts/contacts.service";
import { ActivityStampService } from "../src/crm/activity-stamp.service";
import { MAX_BULK_IDS } from "../src/crm/bulk";
import { parseCsv, writeCsv } from "../src/crm/csv";
import { csvImportInput } from "../src/csv/csv.contracts";
import { CSV } from "../src/csv/csv-config";
import { CsvExportService } from "../src/csv/csv-export.service";
import { CsvImportService } from "../src/csv/csv-import.service";
import { ConversionService } from "../src/currency/conversion.service";
import { DealsService } from "../src/deals/deals.service";
import { FieldsService } from "../src/fields/fields.service";
import { authorizeApiKeyProcedure } from "../src/trpc/api-key-access";
import { withDiscardedCrmEvents } from "./agent-trigger.stub";

const suffix = process.env.TEST_RUN_ID ?? "csv-import-spec";
const slug = suffix.replaceAll("-", "_");
const userId = `user-${suffix}`;
const ownerEmail = `rep-${suffix}@example.test`;
const host = (name: string) => `${name}-${suffix}.test`;
const keys = {
	tier: `tier_${slug}`,
	score: `score_${slug}`,
	renewal: `renewal_${slug}`,
	lead: `lead_${slug}`,
	vip: `vip_${slug}`,
};

const created = { companies: [] as string[], contacts: [] as string[] };

const agent = {
	contactCreated: async (id: string) => {
		created.contacts.push(id);
		return true;
	},
	companyCreated: async (id: string) => {
		created.companies.push(id);
	},
	withCrmEvents: withDiscardedCrmEvents,
	fieldBackfillRecords: async () => ({ queued: 0, merged: 0 }),
} as unknown as AgentTriggerService;

const stamp = new ActivityStampService(db);
const queue = new AgentQueueService(db);
const conversion = new ConversionService(db);
const fields = new FieldsService(db, agent);
const directory = new CompanyDirectoryService(agent);
const companies = new CompaniesService(
	db,
	agent,
	queue,
	{ backfill: async () => undefined } as unknown as FaviconService,
	stamp,
	conversion,
	fields,
);
const contacts = new ContactsService(
	db,
	directory,
	agent,
	queue,
	stamp,
	fields,
);
const deals = new DealsService(db, agent, stamp, conversion, fields);
const exporter = new CsvExportService(db, fields);
const importer = new CsvImportService(
	db,
	exporter,
	fields,
	companies,
	contacts,
	deals,
);

function sheet(header: string[], rows: string[][]): string {
	return writeCsv(
		header,
		rows.map((row) =>
			Object.fromEntries(header.map((h, i) => [h, row[i] ?? ""])),
		),
	);
}

function run(
	entity: "companies" | "contacts" | "deals",
	csv: string,
	dryRun: boolean,
) {
	return importer.import({ entity, csv, dryRun }, userId);
}

function dbDomains() {
	return db.company.findMany({
		where: { domain: { endsWith: `-${suffix}.test` } },
		orderBy: { domain: "asc" },
	});
}

async function clean() {
	await db.fieldDefinition.deleteMany({
		where: { key: { in: Object.values(keys) } },
	});
	await db.deal.deleteMany({
		where: {
			company: {
				OR: [
					{ domain: { endsWith: `-${suffix}.test` } },
					{ name: { startsWith: `Co ${suffix}`, mode: "insensitive" } },
				],
			},
		},
	});
	await db.contact.deleteMany({
		where: { email: { endsWith: `-${suffix}.test` } },
	});
	await db.suppressedContact.deleteMany({
		where: { email: { endsWith: `-${suffix}.test` } },
	});
	await db.company.deleteMany({
		where: {
			OR: [
				{ domain: { endsWith: `-${suffix}.test` } },
				{ name: { startsWith: `Co ${suffix}`, mode: "insensitive" } },
			],
		},
	});
	await db.agentTask.deleteMany({
		where: { reason: { contains: suffix } },
	});
	await db.user.deleteMany({ where: { id: userId } });
}

let tierId: string;

beforeAll(async () => {
	await clean();
	await db.user.create({
		data: { id: userId, name: "Rep", email: ownerEmail, emailVerified: true },
	});
	const tier = await db.fieldDefinition.create({
		data: {
			entity: "COMPANY",
			key: keys.tier,
			label: "Tier",
			type: "SELECT",
			position: 9101,
			agentFilled: false,
			options: {
				create: [
					{ label: "Gold", position: 0 },
					{ label: "Silver", position: 1 },
				],
			},
		},
	});
	tierId = tier.id;
	await db.fieldDefinition.createMany({
		data: [
			{
				entity: "COMPANY",
				key: keys.score,
				label: "Score",
				type: "NUMBER",
				position: 9102,
				agentFilled: false,
			},
			{
				entity: "DEAL",
				key: keys.renewal,
				label: "Renewal",
				type: "DATE",
				position: 9103,
				agentFilled: false,
			},
			{
				entity: "CONTACT",
				key: keys.lead,
				label: "Lead",
				type: "USER",
				position: 9104,
				agentFilled: false,
			},
			{
				entity: "CONTACT",
				key: keys.vip,
				label: "VIP",
				type: "CHECKBOX",
				position: 9105,
				agentFilled: false,
			},
		],
	});
});

beforeEach(() => {
	created.companies.length = 0;
	created.contacts.length = 0;
});

afterAll(clean);

describe("the dry run", () => {
	it("reports what would happen and writes nothing", async () => {
		const csv = sheet(
			["name", "domain", "industry"],
			[
				["Acme", host("dry-a"), "Software"],
				["Beta", host("dry-b"), ""],
			],
		);
		const taskCount = await db.agentTask.count();
		const report = await run("companies", csv, true);

		expect(report).toMatchObject({
			dryRun: true,
			create: 2,
			update: 0,
			skip: 0,
			errors: [],
		});
		expect(await dbDomains()).toHaveLength(0);
		expect(created.companies).toHaveLength(0);
		expect(await db.agentTask.count()).toBe(taskCount);
	});

	it("names the row of every invalid cell and still plans the valid rows", async () => {
		const csv = sheet(
			["name", "domain", "ownerEmail"],
			[
				["Fine", host("fine"), ""],
				["", host("noname"), ""],
				["Bad domain", "not a domain", ""],
				["Ghost owner", host("ghost"), "nobody@example.test"],
				["Dup", host("fine"), ""],
			],
		);
		const report = await run("companies", csv, true);

		expect(report.create).toBe(1);
		expect(report.errors.map((error) => error.row)).toEqual([3, 4, 5, 6]);
		expect(report.errors[0]?.message).toBe("name is required.");
		expect(report.errors[1]?.message).toContain("is not a domain");
		expect(report.errors[2]?.message).toContain("nobody@example.test");
		expect(report.errors[3]?.message).toBe(
			"This is the same company as row 2.",
		);
		expect(await dbDomains()).toHaveLength(0);
	});
});

describe("importing companies", () => {
	it("creates them as IMPORT with custom fields, and queues the agent as a manual create does", async () => {
		const csv = sheet(
			[
				"name",
				"domain",
				"industry",
				"phone",
				"ownerEmail",
				`field:${keys.tier}`,
				`field:${keys.score}`,
			],
			[
				[
					"Acme",
					host("acme"),
					"Software",
					"'+1 555 0100",
					ownerEmail.toUpperCase(),
					"gold",
					"42.5",
				],
			],
		);
		const report = await run("companies", csv, false);

		expect(report).toMatchObject({ create: 1, update: 0, skip: 0, errors: [] });
		const company = await db.company.findFirstOrThrow({
			where: { domain: host("acme") },
			include: { fieldValues: true },
		});
		expect(company.source).toBe(RecordSource.IMPORT);
		expect(company.industry).toBe("Software");
		expect(company.phone).toBe("+1 555 0100");
		expect(company.ownerId).toBe(userId);
		expect(company.fieldValues).toHaveLength(2);
		expect(
			company.fieldValues.find((value) => value.fieldId === tierId)?.optionId,
		).not.toBeNull();
		expect(created.companies).toEqual([company.id]);
	});

	it("updates the company with the same domain instead of duplicating it", async () => {
		const manual = await companies.create({
			name: "Old name",
			domain: host("dupe"),
		});
		const csv = sheet(
			["name", "domain", "city"],
			[["New name", `https://www.${host("dupe")}/about`, "Oslo"]],
		);
		const report = await run("companies", csv, false);

		expect(report).toMatchObject({ create: 0, update: 1, errors: [] });
		const rows = await db.company.findMany({ where: { domain: host("dupe") } });
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			id: manual.id,
			name: "New name",
			city: "Oslo",
			source: RecordSource.MANUAL,
		});
	});

	it("leaves a value alone when its cell is blank, and skips a row that changes nothing", async () => {
		await companies.create({ name: "Keeper", domain: host("keeper") });
		await companies.update(
			(await db.company.findFirstOrThrow({ where: { domain: host("keeper") } }))
				.id,
			{ industry: "Retail" },
		);
		const csv = sheet(
			["name", "domain", "industry"],
			[["Keeper", host("keeper"), ""]],
		);
		const report = await run("companies", csv, false);

		expect(report).toMatchObject({ create: 0, update: 0, skip: 1 });
		expect(report.skipped).toEqual([{ row: 2, message: "Nothing changed." }]);
		const row = await db.company.findFirstOrThrow({
			where: { domain: host("keeper") },
		});
		expect(row.industry).toBe("Retail");
	});

	it("matches a company without a domain on its name", async () => {
		const csv = sheet(["name"], [[`Co ${suffix} nameless`]]);
		expect((await run("companies", csv, false)).create).toBe(1);
		const again = await run(
			"companies",
			sheet(["name", "city"], [[`co ${suffix} NAMELESS`, "Rome"]]),
			false,
		);
		expect(again).toMatchObject({ create: 0, update: 1 });
		expect(
			await db.company.count({
				where: {
					name: { startsWith: `Co ${suffix} nameless`, mode: "insensitive" },
				},
			}),
		).toBe(1);
	});

	it("reads HubSpot headers, ignores columns it does not know and says so", async () => {
		const csv = sheet(
			[
				"Company name",
				"Company Domain Name",
				"Phone Number",
				"Record ID",
				"Lifecycle Stage",
			],
			[["Hub Co", host("hub"), "555", "123", "customer"]],
		);
		const report = await run("companies", csv, false);

		expect(report.create).toBe(1);
		expect(report.ignoredColumns).toEqual(["Record ID", "Lifecycle Stage"]);
		const row = await db.company.findFirstOrThrow({
			where: { domain: host("hub") },
		});
		expect(row).toMatchObject({ name: "Hub Co", phone: "555" });
	});

	it("takes a header mapping from the caller", async () => {
		const csv = sheet(["Account", "Site"], [["Mapped Co", host("mapped")]]);
		const report = await importer.import(
			{
				entity: "companies",
				csv,
				dryRun: false,
				mapping: { Account: "name", Site: "domain" },
			},
			userId,
		);
		expect(report.create).toBe(1);
		expect(await db.company.count({ where: { domain: host("mapped") } })).toBe(
			1,
		);
	});

	it("rejects a file with no name column, an unclosed quote and too many rows", async () => {
		await expect(
			run("companies", `domain\n${host("x")}`, true),
		).rejects.toThrow(BadRequestException);
		await expect(run("companies", 'name\n"never closed', true)).rejects.toThrow(
			"Line 2",
		);
		const rows = Array.from({ length: CSV.import.maxRows + 1 }, (_, index) => [
			`N${index}`,
		]);
		await expect(run("companies", sheet(["name"], rows), true)).rejects.toThrow(
			"Split it",
		);
		expect(
			csvImportInput.safeParse({ entity: "companies", csv: "", dryRun: true })
				.success,
		).toBe(false);
		expect(
			csvImportInput.safeParse({
				entity: "companies",
				csv: "a".repeat(CSV.import.maxBytes + 1),
				dryRun: true,
			}).success,
		).toBe(false);
	});
});

describe("importing contacts", () => {
	let companyId: string;

	beforeAll(async () => {
		const company = await companies.create({
			name: "Home",
			domain: host("home"),
		});
		companyId = company.id;
	});

	it("creates them under the company with that domain as IMPORT and queues the agent", async () => {
		const csv = sheet(
			[
				"First Name",
				"Last Name",
				"Email",
				"Job Title",
				"Company Domain Name",
				`field:${keys.vip}`,
				`field:${keys.lead}`,
			],
			[
				[
					"Ada",
					"Lovelace",
					`Ada@People-${suffix}.test`,
					"Engineer",
					host("home"),
					"true",
					ownerEmail,
				],
			],
		);
		const report = await run("contacts", csv, false);

		expect(report).toMatchObject({ create: 1, update: 0, errors: [] });
		const contact = await db.contact.findFirstOrThrow({
			where: { email: `ada@people-${suffix}.test` },
			include: { fieldValues: true },
		});
		expect(contact).toMatchObject({
			firstName: "Ada",
			lastName: "Lovelace",
			title: "Engineer",
			companyId,
			source: RecordSource.IMPORT,
		});
		expect(contact.fieldValues).toHaveLength(2);
		expect(created.contacts).toEqual([contact.id]);
	});

	it("finds an existing contact whatever the case of the email and updates it", async () => {
		const email = `case@people-${suffix}.test`;
		const existing = await contacts.create({
			firstName: "Case",
			email,
			companyId,
		});
		const csv = sheet(
			["firstName", "email", "title"],
			[["Case", email.toUpperCase(), "Director"]],
		);
		const report = await run("contacts", csv, false);

		expect(report).toMatchObject({ create: 0, update: 1 });
		const rows = await db.contact.findMany({
			where: { email: { equals: email, mode: "insensitive" } },
		});
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ id: existing.id, title: "Director" });
	});

	it("does not bring back somebody who was removed", async () => {
		const email = `gone@people-${suffix}.test`;
		await db.suppressedContact.create({ data: { email } });
		const csv = sheet(["firstName", "email"], [["Gone", email.toUpperCase()]]);

		const dry = await run("contacts", csv, true);
		const report = await run("contacts", csv, false);

		expect(dry).toMatchObject({ create: 0, skip: 1 });
		expect(report).toMatchObject({ create: 0, skip: 1, errors: [] });
		expect(report.skipped[0]?.message).toContain("removed from the CRM");
		expect(await db.contact.count({ where: { email } })).toBe(0);
		expect(await db.suppressedContact.count({ where: { email } })).toBe(1);
	});

	it("reports a company that does not exist, a bad email and a repeated email by row", async () => {
		const csv = sheet(
			["firstName", "email", "companyDomain"],
			[
				["A", `a@people-${suffix}.test`, host("nowhere")],
				["B", "not-an-email", ""],
				["C", `c@people-${suffix}.test`, ""],
				["D", `C@people-${suffix}.test`, ""],
				["", `e@people-${suffix}.test`, ""],
			],
		);
		const report = await run("contacts", csv, true);

		expect(report.create).toBe(1);
		expect(report.errors.map((error) => error.row)).toEqual([2, 3, 5, 6]);
		expect(report.errors[0]?.message).toContain("Import the companies first");
		expect(report.errors[1]?.message).toContain("is not an email address");
		expect(report.errors[2]?.message).toContain("already in row 4");
		expect(report.errors[3]?.message).toBe("firstName is required.");
	});

	it("links a company by name when the file has no domain", async () => {
		const named = await db.company.create({
			data: { name: `Co ${suffix} named` },
		});
		const csv = sheet(
			["firstName", "email", "Associated Company"],
			[["N", `n@people-${suffix}.test`, `co ${suffix} NAMED`]],
		);
		const report = await run("contacts", csv, false);
		expect(report.create).toBe(1);
		expect(
			(
				await db.contact.findFirstOrThrow({
					where: { email: `n@people-${suffix}.test` },
				})
			).companyId,
		).toBe(named.id);
	});
});

describe("importing deals", () => {
	let companyId: string;
	const header = [
		"name",
		"companyDomain",
		"stage",
		"amount",
		"currency",
		"expectedCloseDate",
		"ownerEmail",
	];

	beforeAll(async () => {
		const company = await companies.create({
			name: "Dealer",
			domain: host("dealer"),
		});
		companyId = company.id;
	});

	it("creates a deal through the currency path with amounts in major units", async () => {
		const csv = sheet(header, [
			[
				"Big one",
				host("dealer"),
				"Contract sent",
				"1234.50",
				"usd",
				"2027-03-31",
				"",
			],
		]);
		const report = await run("deals", csv, false);

		expect(report).toMatchObject({ create: 1, errors: [] });
		const deal = await db.deal.findFirstOrThrow({
			where: { companyId, name: "Big one" },
		});
		expect(deal.stage).toBe("CONTRACT_SENT");
		expect(deal.amount?.toFixed(2)).toBe("1234.50");
		expect(deal.currency).toBe("USD");
		expect(deal.ownerId).toBe(userId);
		expect(deal.expectedCloseDate?.toISOString()).toBe(
			"2027-03-31T00:00:00.000Z",
		);
		const base = await conversion.reportingCurrency();
		if (base === "USD") {
			expect(deal.baseAmount?.toFixed(2)).toBe("1234.50");
			expect(deal.baseCurrency).toBe("USD");
		}
	});

	it("skips an unchanged deal, so a frozen rate is never re-struck", async () => {
		const before = await db.deal.findFirstOrThrow({
			where: { companyId, name: "Big one" },
		});
		const csv = sheet(header, [
			[
				"big ONE",
				host("dealer"),
				"CONTRACT_SENT",
				"1234.50",
				"USD",
				"2027-03-31",
				ownerEmail,
			],
		]);
		const report = await run("deals", csv, false);

		expect(report).toMatchObject({ create: 0, update: 0, skip: 1 });
		const after = await db.deal.findFirstOrThrow({ where: { id: before.id } });
		expect(after.fxRateAt).toEqual(before.fxRateAt);
		expect(after.updatedAt).toEqual(before.updatedAt);
	});

	it("updates the amount and the stage of the deal with the same name and company", async () => {
		const csv = sheet(header, [
			["Big one", host("dealer"), "Closed won", "2000", "", "", ""],
		]);
		const report = await run("deals", csv, false);

		expect(report).toMatchObject({ create: 0, update: 1, errors: [] });
		const rows = await db.deal.findMany({
			where: { companyId, name: "Big one" },
		});
		expect(rows).toHaveLength(1);
		expect(rows[0]?.amount?.toFixed(2)).toBe("2000.00");
		expect(rows[0]?.stage).toBe("CLOSED_WON");
		expect(rows[0]?.closedAt).not.toBeNull();
	});

	it("reports a bad stage, amount, currency, date and a missing company by row", async () => {
		const csv = sheet(header, [
			["Bad stage", host("dealer"), "Negotiating", "", "", "", ""],
			["Bad amount", host("dealer"), "", "$1,000", "", "", ""],
			["Bad currency", host("dealer"), "", "10", "ZZZ", "", ""],
			["Bad date", host("dealer"), "", "", "", "31/03/2027", ""],
			["No company", host("missing"), "", "", "", "", ""],
			["Fine", host("dealer"), "", "5", "EUR", "", ""],
		]);
		const report = await run("deals", csv, true);

		expect(report.create).toBe(1);
		expect(report.errors.map((error) => error.row)).toEqual([2, 3, 4, 5, 6]);
		expect(report.errors[0]?.message).toContain("is not a stage");
		expect(report.errors[1]?.message).toContain("is not an amount");
		expect(report.errors[2]?.message).toContain("currency");
		expect(report.errors[3]?.message).toContain("is not a date");
		expect(report.errors[4]?.message).toContain("No company has the domain");
	});

	it("needs a company column", async () => {
		await expect(run("deals", sheet(["name"], [["x"]]), true)).rejects.toThrow(
			"A deal belongs to a company",
		);
	});
});

describe("the key profiles", () => {
	const decide = (profile: ApiKeyProfile, path: string, type: string) =>
		authorizeApiKeyProcedure(
			{ id: "key", referenceId: "key", permissions: KEY_PERMISSIONS[profile] },
			path,
			type,
		);

	it("lets a session-like crm_integration key import and denies the agent profiles", () => {
		expect(decide("crm_integration", "csv.import", "mutation")).toBe("allow");
		expect(decide("agent_propose", "csv.import", "mutation")).toBe("deny");
		expect(decide("agent_read", "csv.import", "mutation")).toBe("deny");
	});

	it("lets every profile export", () => {
		for (const profile of [
			"crm_integration",
			"agent_propose",
			"agent_read",
		] as const) {
			expect(decide(profile, "csv.export", "query")).toBe("allow");
		}
	});
});

describe("a file larger than one batch", () => {
	it("applies every row, in order, across batches", async () => {
		const count = MAX_BULK_IDS + 20;
		const rows = Array.from({ length: count }, (_, index) => [
			`Batch ${index}`,
			host(`batch${index}`),
		]);
		const report = await run(
			"companies",
			sheet(["name", "domain"], rows),
			false,
		);

		expect(report).toMatchObject({ create: count, errors: [] });
		const stored = await db.company.count({
			where: {
				domain: { startsWith: "batch" },
				source: RecordSource.IMPORT,
				name: { startsWith: "Batch " },
			},
		});
		expect(stored).toBe(count);
	});
});

describe("a round trip", () => {
	const prefix = `rt-${suffix}`;
	const stable = (cells: Record<string, string>) => {
		const { id: _id, createdAt: _createdAt, source: _source, ...rest } = cells;
		return rest;
	};

	async function snapshot(entity: "companies" | "contacts" | "deals") {
		const { csv } = await exporter.export(entity);
		const [header = [], ...rows] = parseCsv(csv);
		const mine = rows.filter((row) => row.join("\u0000").includes(prefix));
		const objects = mine.map((row) =>
			Object.fromEntries(header.map((h, i) => [h, row[i] ?? ""])),
		);
		return { header, objects, text: writeCsv(header, objects) };
	}

	it("brings back every field of every record after the records are wiped", async () => {
		const tier = await db.fieldOption.findFirstOrThrow({
			where: { fieldId: tierId, label: "Silver" },
		});
		const alpha = await db.company.create({
			data: {
				name: `Alpha, "Quoted" ${prefix}`,
				domain: host(`${prefix}-alpha`),
				website: `https://${host(`${prefix}-alpha`)}`,
				description: "Line one\nLine two",
				industry: "Software",
				city: "Oslo",
				country: "Norway",
				phone: "+47 555 0100",
				email: "hello@alpha.test",
				linkedinUrl: "https://linkedin.com/company/alpha",
				ownerId: userId,
			},
		});
		const nameless = await db.company.create({
			data: { name: `Co ${suffix} ${prefix} nameless` },
		});
		const score = await db.fieldDefinition.findFirstOrThrow({
			where: { key: keys.score },
		});
		await db.fieldValue.createMany({
			data: [
				{ fieldId: tierId, companyId: alpha.id, optionId: tier.id },
				{ fieldId: score.id, companyId: alpha.id, number: 7.25 },
			],
		});
		const lead = await db.fieldDefinition.findFirstOrThrow({
			where: { key: keys.lead },
		});
		const vip = await db.fieldDefinition.findFirstOrThrow({
			where: { key: keys.vip },
		});
		const grace = await db.contact.create({
			data: {
				firstName: "Grace",
				lastName: "Hopper",
				email: `grace@${prefix}-${suffix}.test`,
				title: "=Admiral",
				phone: "+1 555 0101",
				linkedinUrl: "https://linkedin.com/in/grace",
				companyId: alpha.id,
				ownerId: userId,
			},
		});
		const solo = await db.contact.create({
			data: {
				firstName: "Solo",
				email: `solo@${prefix}-${suffix}.test`,
				companyId: nameless.id,
			},
		});
		await db.fieldValue.createMany({
			data: [
				{ fieldId: lead.id, contactId: grace.id, userId },
				{ fieldId: vip.id, contactId: grace.id, bool: true },
			],
		});
		const renewal = await db.fieldDefinition.findFirstOrThrow({
			where: { key: keys.renewal },
		});
		const won = await db.deal.create({
			data: {
				name: `Renewal ${prefix}`,
				description: "Multi, comma",
				companyId: alpha.id,
				ownerId: userId,
				stage: "CONTRACT_SENT",
				amount: 9999.99,
				currency: "EUR",
				expectedCloseDate: new Date("2027-06-30T00:00:00.000Z"),
			},
		});
		const lost = await db.deal.create({
			data: {
				name: `Lost ${prefix}`,
				companyId: nameless.id,
				ownerId: userId,
				stage: "CLOSED_LOST",
				closedReason: "Budget",
				closedAt: new Date(),
			},
		});
		await db.fieldValue.create({
			data: {
				fieldId: renewal.id,
				dealId: won.id,
				date: new Date("2027-12-01T00:00:00.000Z"),
			},
		});

		const before = {
			companies: await snapshot("companies"),
			contacts: await snapshot("contacts"),
			deals: await snapshot("deals"),
		};
		expect(before.companies.objects).toHaveLength(2);
		expect(before.contacts.objects).toHaveLength(2);
		expect(before.deals.objects).toHaveLength(2);

		await db.deal.deleteMany({ where: { id: { in: [won.id, lost.id] } } });
		await db.contact.deleteMany({ where: { id: { in: [grace.id, solo.id] } } });
		await db.company.deleteMany({
			where: { id: { in: [alpha.id, nameless.id] } },
		});

		const dry = await run("companies", before.companies.text, true);
		expect(dry).toMatchObject({ create: 2, errors: [] });
		expect(
			await db.company.count({
				where: { id: { in: [alpha.id, nameless.id] } },
			}),
		).toBe(0);
		expect(
			await db.company.count({
				where: { OR: [{ domain: alpha.domain }, { name: nameless.name }] },
			}),
		).toBe(0);

		expect(await run("companies", before.companies.text, false)).toMatchObject({
			create: 2,
			errors: [],
		});
		expect(await run("contacts", before.contacts.text, false)).toMatchObject({
			create: 2,
			errors: [],
		});
		expect(await run("deals", before.deals.text, false)).toMatchObject({
			create: 2,
			errors: [],
		});

		const after = {
			companies: await snapshot("companies"),
			contacts: await snapshot("contacts"),
			deals: await snapshot("deals"),
		};

		const sorted = (rows: Array<Record<string, string>>) =>
			rows
				.map(stable)
				.sort((left, right) =>
					JSON.stringify(left).localeCompare(JSON.stringify(right)),
				);
		expect(after.companies.header).toEqual(before.companies.header);
		expect(sorted(after.companies.objects)).toEqual(
			sorted(before.companies.objects),
		);
		expect(sorted(after.contacts.objects)).toEqual(
			sorted(before.contacts.objects),
		);
		expect(sorted(after.deals.objects)).toEqual(sorted(before.deals.objects));

		for (const row of after.companies.objects.concat(after.contacts.objects)) {
			expect(row.source).toBe("IMPORT");
		}

		const again = await run("companies", before.companies.text, false);
		expect(again).toMatchObject({ create: 0, update: 0, skip: 2 });
		const againDeals = await run("deals", before.deals.text, false);
		expect(againDeals).toMatchObject({ create: 0, update: 0, skip: 2 });
	});
});
