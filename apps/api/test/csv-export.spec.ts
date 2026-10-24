import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import { CSV_COLUMNS } from "../src/csv/csv-columns";
import { CsvExportService } from "../src/csv/csv-export.service";
import { FieldsService } from "../src/fields/fields.service";

const suffix = process.env.TEST_RUN_ID ?? "csv-export-spec";
const userId = `user-${suffix}`;
const ownerEmail = `owner-${suffix}@example.test`;
const domain = `export-${suffix}.test`;
const archivedDomain = `archived-${suffix}.test`;

const fields = new FieldsService(db, {
	fieldBackfill: async () => undefined,
} as never);
const exporter = new CsvExportService(db, fields);

const keys = {
	tier: `tier_${suffix.replaceAll("-", "_")}`,
	score: `score_${suffix.replaceAll("-", "_")}`,
	renewal: `renewal_${suffix.replaceAll("-", "_")}`,
	lead: `lead_${suffix.replaceAll("-", "_")}`,
};

let companyId: string;
let contactId: string;
let dealId: string;

async function clean() {
	await db.fieldDefinition.deleteMany({
		where: { key: { in: Object.values(keys) } },
	});
	await db.deal.deleteMany({
		where: { company: { domain: { in: [domain, archivedDomain] } } },
	});
	await db.contact.deleteMany({
		where: { email: { endsWith: `-${suffix}.test` } },
	});
	await db.company.deleteMany({
		where: { domain: { in: [domain, archivedDomain] } },
	});
	await db.user.deleteMany({ where: { id: userId } });
}

function lineFor(csv: string, id: string): string {
	const line = csv.split("\r\n").find((entry) => entry.includes(id));
	if (!line) throw new Error(`No line for ${id}`);
	return line;
}

beforeAll(async () => {
	await clean();
	await db.user.create({
		data: { id: userId, name: "Owner", email: ownerEmail, emailVerified: true },
	});

	const tier = await db.fieldDefinition.create({
		data: {
			entity: "COMPANY",
			key: keys.tier,
			label: "Tier",
			type: "SELECT",
			position: 9001,
			options: {
				create: [
					{ label: "Gold", position: 0 },
					{ label: "Silver", position: 1 },
				],
			},
		},
		include: { options: true },
	});
	const score = await db.fieldDefinition.create({
		data: {
			entity: "COMPANY",
			key: keys.score,
			label: "Score",
			type: "NUMBER",
			position: 9002,
		},
	});
	const renewal = await db.fieldDefinition.create({
		data: {
			entity: "DEAL",
			key: keys.renewal,
			label: "Renewal",
			type: "DATE",
			position: 9003,
		},
	});
	const lead = await db.fieldDefinition.create({
		data: {
			entity: "CONTACT",
			key: keys.lead,
			label: "Lead",
			type: "USER",
			position: 9004,
		},
	});

	const company = await db.company.create({
		data: {
			name: `Acme, "Export" ${suffix}`,
			domain,
			industry: "Software",
			phone: "+1 555 0100",
			ownerId: userId,
		},
	});
	companyId = company.id;
	const gold = tier.options.find((option) => option.label === "Gold");
	await db.fieldValue.createMany({
		data: [
			{ fieldId: tier.id, companyId, optionId: gold?.id },
			{ fieldId: score.id, companyId, number: 42.5 },
		],
	});

	const contact = await db.contact.create({
		data: {
			firstName: "Ada",
			lastName: "Lovelace",
			email: `ada@people-${suffix}.test`,
			title: "=cmd|' /C calc'!A0",
			companyId,
			ownerId: userId,
		},
	});
	contactId = contact.id;
	await db.fieldValue.create({
		data: { fieldId: lead.id, contactId, userId },
	});

	const deal = await db.deal.create({
		data: {
			name: "Renewal 2027",
			companyId,
			ownerId: userId,
			stage: "CONTRACT_SENT",
			amount: 1234.5,
			currency: "EUR",
			expectedCloseDate: new Date("2027-03-31T00:00:00.000Z"),
		},
	});
	dealId = deal.id;
	await db.fieldValue.create({
		data: {
			fieldId: renewal.id,
			dealId,
			date: new Date("2027-12-01T00:00:00.000Z"),
		},
	});

	const archived = await db.company.create({
		data: {
			name: `Gone ${suffix}`,
			domain: archivedDomain,
			archivedAt: new Date(),
		},
	});
	await db.contact.create({
		data: {
			firstName: "Archived",
			email: `archived@gone-${suffix}.test`,
			archivedAt: new Date(),
		},
	});
	await db.deal.create({
		data: {
			name: `Archived deal ${suffix}`,
			companyId: archived.id,
			ownerId: userId,
			archivedAt: new Date(),
		},
	});
});

afterAll(clean);

describe("exporting companies", () => {
	it("writes the header, then one line per active company with its custom fields", async () => {
		const result = await exporter.export("companies");
		const [header] = result.csv.split("\r\n");

		expect(header).toBe(
			[
				...CSV_COLUMNS.companies,
				...(await fields.definitionsFor("COMPANY")).map(
					(definition) => `field:${definition.key}`,
				),
			].join(","),
		);
		expect(header).toContain(`field:${keys.tier}`);
		expect(header).toContain(`field:${keys.score}`);

		const line = lineFor(result.csv, companyId);
		expect(line).toContain(`"Acme, ""Export"" ${suffix}"`);
		expect(line).toContain(`,${domain},`);
		expect(line).toContain(`,'+1 555 0100,`);
		expect(line).toContain(`,${ownerEmail},MANUAL,`);
		expect(line.endsWith(",Gold,42.5")).toBe(true);
	});

	it("leaves archived companies out", async () => {
		const result = await exporter.export("companies");
		expect(result.csv).not.toContain(archivedDomain);
		expect(result.truncated).toBe(false);
	});
});

describe("exporting contacts", () => {
	it("writes company domain, owner email, neutralises formulas and maps USER fields to emails", async () => {
		const result = await exporter.export("contacts");
		const line = lineFor(result.csv, contactId);

		expect(line).toContain(`,Ada,Lovelace,`);
		expect(line).toContain(`'=cmd|' /C calc'!A0`);
		expect(line).toContain(`,${domain},`);
		expect(line.endsWith(`,${ownerEmail}`)).toBe(true);
		expect(result.csv).not.toContain(`gone-${suffix}`);
	});
});

describe("exporting deals", () => {
	it("writes amount in major units with currency, stage, date and owner", async () => {
		const result = await exporter.export("deals");
		const line = lineFor(result.csv, dealId);

		expect(line).toContain(`,Renewal 2027,,${domain},`);
		expect(line).toContain(",CONTRACT_SENT,,1234.50,EUR,2027-03-31,");
		expect(line).toContain(`,${ownerEmail},`);
		expect(line.endsWith(",2027-12-01")).toBe(true);
		expect(result.csv).not.toContain(`Archived deal ${suffix}`);
	});
});

describe("paging and the row cap", () => {
	const extra = [1, 2, 3].map((n) => `page${n}-${suffix}.test`);

	beforeAll(async () => {
		await db.company.createMany({
			data: extra.map((host) => ({ name: host, domain: host })),
		});
	});

	afterAll(async () => {
		await db.company.deleteMany({ where: { domain: { in: extra } } });
	});

	it("reads every row across pages", async () => {
		const result = await exporter.export("companies", {
			maxRows: 1000,
			pageSize: 2,
		});
		for (const host of extra) expect(result.csv).toContain(host);
		expect(result.truncated).toBe(false);
	});

	it("stops at the cap and says it did", async () => {
		const result = await exporter.export("companies", {
			maxRows: 2,
			pageSize: 1,
		});
		expect(result.rows).toBe(2);
		expect(result.truncated).toBe(true);
		expect(result.csv.split("\r\n")).toHaveLength(4);
	});
});
