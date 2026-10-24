import { type Db, RecordSource } from "@crm/db";
import { isClosedStage } from "@crm/db/deal-stage";
import {
	coerceValue,
	type FieldDefinitionWithOptions,
	FieldValueError,
} from "@crm/db/fields";
import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import type { CompanyUpdateInput } from "../companies/companies.contracts";
import { CompaniesService } from "../companies/companies.service";
import type { ContactUpdateInput } from "../contacts/contacts.contracts";
import { ContactsService } from "../contacts/contacts.service";
import { MAX_BULK_IDS } from "../crm/bulk";
import {
	CsvParseError,
	type CsvRow,
	parseCsv,
	unprotectCell,
} from "../crm/csv";
import { InjectDatabase } from "../database/database.constants";
import type { DealUpdateInput } from "../deals/deals.contracts";
import { DealsService } from "../deals/deals.service";
import type { recordFieldValues } from "../fields/fields.contracts";
import { FieldsService } from "../fields/fields.service";
import type { CsvImportInput } from "./csv.contracts";
import {
	COLUMN_ALIASES,
	CSV_COLUMNS,
	type CsvEntity,
	FIELD_PREFIX,
	INFORMATION_COLUMNS,
	REQUIRED_COLUMNS,
} from "./csv-columns";
import { CSV } from "./csv-config";
import {
	CsvExportService,
	type CsvRecord,
	FIELD_ENTITIES,
} from "./csv-export.service";
import {
	amountCentsOf,
	type CompanyRow,
	type ContactRow,
	companyRow,
	contactRow,
	type DealRow,
	dealRow,
	describeIssues,
} from "./csv-rows";

type RowNote = { row: number; message: string };

type ImportReport = {
	dryRun: boolean;
	create: number;
	update: number;
	skip: number;
	errors: RowNote[];
	skipped: RowNote[];
	ignoredColumns: string[];
};

type FieldValues = z.infer<typeof recordFieldValues>;

type Line = { row: number; cells: CsvRow; fields: CsvRow };

type Table = { lines: Line[]; errors: RowNote[]; ignoredColumns: string[] };

type Op = { row: number; kind: "create" | "update"; run: () => Promise<void> };

type Plan = { ops: Op[]; skipped: RowNote[]; errors: RowNote[] };

type Context = {
	actingUserId: string;
	users: Map<string, string>;
	definitions: FieldDefinitionWithOptions[];
};

type Resolved<Value> =
	| { ok: true; value: Value }
	| { ok: false; message: string };

type ResolvedColumns = { targets: Target[]; ignoredColumns: string[] };

type ParsedRows<Row> = {
	rows: Array<{ line: Line; data: Row }>;
	errors: RowNote[];
};

type Target =
	| { kind: "column"; name: string }
	| { kind: "field"; key: string }
	| { kind: "skip" };

type CompanyLookup = {
	byDomain: Map<string, string>;
	byName: Map<string, string[]>;
};

const COMPANY_TEXT = [
	"website",
	"description",
	"industry",
	"city",
	"stateCode",
	"country",
	"phone",
	"email",
	"linkedinUrl",
] as const;

const CONTACT_TEXT = [
	"lastName",
	"phone",
	"title",
	"linkedinUrl",
	"twitterUrl",
	"githubUrl",
] as const;

function chunked<Item>(items: Item[], size = MAX_BULK_IDS): Item[][] {
	const chunks: Item[][] = [];
	for (let index = 0; index < items.length; index += size) {
		chunks.push(items.slice(index, index + size));
	}
	return chunks;
}

function unique(values: Array<string | undefined>): string[] {
	return [...new Set(values.filter((value) => value !== undefined))];
}

@Injectable()
export class CsvImportService {
	private readonly logger = new Logger(CsvImportService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly exporter: CsvExportService,
		private readonly fields: FieldsService,
		private readonly companies: CompaniesService,
		private readonly contacts: ContactsService,
		private readonly deals: DealsService,
	) {}

	async import(
		input: CsvImportInput,
		actingUserId: string,
	): Promise<ImportReport> {
		const definitions = await this.fields.definitionsFor(
			FIELD_ENTITIES[input.entity],
		);
		const table = this.read(input, definitions);
		const users = await this.db.user.findMany({
			select: { id: true, email: true },
		});
		const context: Context = {
			actingUserId,
			users: new Map(users.map((user) => [user.email.toLowerCase(), user.id])),
			definitions,
		};

		const plan = await this.plan(input.entity, table.lines, context);
		const errors = [...table.errors, ...plan.errors];
		const creates = plan.ops.filter((op) => op.kind === "create").length;

		let create = creates;
		let update = plan.ops.length - creates;

		if (!input.dryRun) {
			const applied = await this.apply(plan.ops);
			errors.push(...applied.errors);
			create = applied.create;
			update = applied.update;
		}

		errors.sort((left, right) => left.row - right.row);

		this.logger.log({
			message: input.dryRun ? "CSV import checked" : "CSV imported",
			entity: input.entity,
			create,
			update,
			skip: plan.skipped.length,
			errors: errors.length,
		});

		return {
			dryRun: input.dryRun,
			create,
			update,
			skip: plan.skipped.length,
			errors,
			skipped: plan.skipped,
			ignoredColumns: table.ignoredColumns,
		};
	}

	private read(
		input: CsvImportInput,
		definitions: FieldDefinitionWithOptions[],
	): Table {
		let records: string[][];
		try {
			records = parseCsv(input.csv);
		} catch (error) {
			if (error instanceof CsvParseError) {
				throw new BadRequestException(error.message);
			}
			throw error;
		}

		const [header, ...rows] = records;
		if (!header) {
			throw new BadRequestException("The file has no header row.");
		}
		if (rows.length > CSV.import.maxRows) {
			throw new BadRequestException(
				`The file has ${rows.length} rows. One import takes at most ${CSV.import.maxRows}. Split it and import the parts.`,
			);
		}

		const { targets, ignoredColumns } = this.resolveColumns(
			input.entity,
			header,
			input.mapping ?? {},
			definitions,
		);
		this.requireColumns(input.entity, targets);

		const lines: Line[] = [];
		const errors: RowNote[] = [];

		rows.forEach((cells, index) => {
			const row = index + 2;
			if (cells.length > header.length) {
				errors.push({
					row,
					message: `The row has ${cells.length} cells and the header has ${header.length}. A comma may be missing its quotes.`,
				});
				return;
			}
			const line: Line = { row, cells: {}, fields: {} };
			targets.forEach((target, position) => {
				const value = unprotectCell(cells[position] ?? "");
				if (target.kind === "column") line.cells[target.name] = value;
				if (target.kind === "field") line.fields[target.key] = value;
			});
			lines.push(line);
		});

		return { lines, errors, ignoredColumns };
	}

	private resolveColumns(
		entity: CsvEntity,
		header: string[],
		mapping: Record<string, string>,
		definitions: FieldDefinitionWithOptions[],
	): ResolvedColumns {
		const known = new Map(
			CSV_COLUMNS[entity].map((column) => [column.toLowerCase(), column]),
		);
		const aliases = new Map<string, string>(
			Object.entries(COLUMN_ALIASES[entity]),
		);
		const information = new Set<string>(
			INFORMATION_COLUMNS.map((column) => column.toLowerCase()),
		);
		const fieldKeys = new Map(
			definitions.map((definition) => [
				definition.key.toLowerCase(),
				definition.key,
			]),
		);
		const used = new Set<string>();
		const ignoredColumns: string[] = [];

		const targets = header.map((raw): Target => {
			const name = raw.trim();
			const lower = (mapping[name] ?? name).trim().toLowerCase();
			if (information.has(lower)) return { kind: "skip" };

			const column = known.get(lower) ?? aliases.get(lower);
			if (column && !used.has(column)) {
				used.add(column);
				return { kind: "column", name: column };
			}

			const key = lower.startsWith(FIELD_PREFIX)
				? fieldKeys.get(lower.slice(FIELD_PREFIX.length).trim())
				: undefined;
			if (key && !used.has(FIELD_PREFIX + key)) {
				used.add(FIELD_PREFIX + key);
				return { kind: "field", key };
			}

			ignoredColumns.push(name);
			return { kind: "skip" };
		});

		return { targets, ignoredColumns };
	}

	private requireColumns(entity: CsvEntity, targets: Target[]): void {
		const present = new Set(
			targets.flatMap((target) =>
				target.kind === "column" ? [target.name] : [],
			),
		);
		for (const column of REQUIRED_COLUMNS[entity]) {
			if (!present.has(column)) {
				throw new BadRequestException(
					`The file has no ${column} column. Add one, or map a header to it.`,
				);
			}
		}
		if (
			entity === "deals" &&
			!present.has("companyDomain") &&
			!present.has("companyName")
		) {
			throw new BadRequestException(
				"The file has no companyDomain or companyName column. A deal belongs to a company.",
			);
		}
	}

	private plan(
		entity: CsvEntity,
		lines: Line[],
		context: Context,
	): Promise<Plan> {
		switch (entity) {
			case "companies":
				return this.planCompanies(lines, context);
			case "contacts":
				return this.planContacts(lines, context);
			case "deals":
				return this.planDeals(lines, context);
		}
	}

	private parseRows<Row>(
		lines: Line[],
		schema: z.ZodType<Row>,
	): ParsedRows<Row> {
		const rows: Array<{ line: Line; data: Row }> = [];
		const errors: RowNote[] = [];

		for (const line of lines) {
			const parsed = schema.safeParse(line.cells);
			if (parsed.success) {
				rows.push({ line, data: parsed.data });
			} else {
				errors.push({ row: line.row, message: describeIssues(parsed.error) });
			}
		}

		return { rows, errors };
	}

	private async planCompanies(lines: Line[], context: Context): Promise<Plan> {
		const parsed = this.parseRows<CompanyRow>(lines, companyRow);
		const plan: Plan = { ops: [], skipped: [], errors: parsed.errors };

		const byDomain = new Map<string, CsvRecord>();
		const byName = new Map<string, CsvRecord[]>();

		for (const domains of chunked(
			unique(parsed.rows.map(({ data }) => data.domain)),
		)) {
			const records = await this.exporter.companyRecords({
				archivedAt: null,
				domain: { in: domains },
			});
			for (const record of records)
				byDomain.set(record.cells.domain ?? "", record);
		}
		for (const names of chunked(
			unique(
				parsed.rows.flatMap(({ data }) =>
					data.domain ? [] : [data.name.toLowerCase()],
				),
			),
		)) {
			const records = await this.exporter.companyRecords({
				archivedAt: null,
				domain: null,
				name: { in: names, mode: "insensitive" },
			});
			for (const record of records) {
				const key = (record.cells.name ?? "").toLowerCase();
				byName.set(key, [...(byName.get(key) ?? []), record]);
			}
		}

		const seen = new Map<string, number>();

		for (const { line, data } of parsed.rows) {
			const key = data.domain ?? `name:${data.name.toLowerCase()}`;
			const first = seen.get(key);
			if (first !== undefined) {
				plan.errors.push({
					row: line.row,
					message: `This is the same company as row ${first}.`,
				});
				continue;
			}
			seen.set(key, line.row);

			const matches = data.domain
				? [byDomain.get(data.domain)].filter((match) => match !== undefined)
				: (byName.get(data.name.toLowerCase()) ?? []);
			if (matches.length > 1) {
				plan.errors.push({
					row: line.row,
					message: `More than one company without a domain is called "${data.name}". Give this one a domain.`,
				});
				continue;
			}
			const existing = matches[0];
			const current = existing?.cells ?? {};

			const owner = this.owner(data.ownerEmail, context);
			if (!owner.ok) {
				plan.errors.push({ row: line.row, message: owner.message });
				continue;
			}
			const values = this.fieldValues(line, existing?.cells, context);
			if (!values.ok) {
				plan.errors.push({ row: line.row, message: values.message });
				continue;
			}

			const patch: CompanyUpdateInput = {};
			for (const column of COMPANY_TEXT) {
				const value = data[column];
				if (value !== undefined && value !== current[column]) {
					patch[column] = value;
				}
			}
			if (Object.keys(values.value).length > 0) patch.fields = values.value;

			if (!existing) {
				plan.ops.push({
					row: line.row,
					kind: "create",
					run: async () => {
						const created = await this.companies.create(
							{
								name: data.name,
								domain: data.domain,
								ownerId: owner.value,
							},
							{ source: RecordSource.IMPORT },
						);
						if (Object.keys(patch).length > 0) {
							await this.companies.update(created.id, patch);
						}
					},
				});
				continue;
			}

			if (data.name !== current.name) patch.name = data.name;
			if (
				owner.value &&
				data.ownerEmail !== current.ownerEmail?.toLowerCase()
			) {
				patch.ownerId = owner.value;
			}
			if (Object.keys(patch).length === 0) {
				plan.skipped.push({ row: line.row, message: "Nothing changed." });
				continue;
			}
			plan.ops.push({
				row: line.row,
				kind: "update",
				run: async () => {
					await this.companies.update(existing.id, patch);
				},
			});
		}

		return plan;
	}

	private async planContacts(lines: Line[], context: Context): Promise<Plan> {
		const parsed = this.parseRows<ContactRow>(lines, contactRow);
		const plan: Plan = { ops: [], skipped: [], errors: parsed.errors };

		const emails = unique(parsed.rows.map(({ data }) => data.email));
		const existingByEmail = new Map<string, CsvRecord>();
		const suppressed = new Set<string>();

		for (const chunk of chunked(emails)) {
			const records = await this.exporter.contactRecords({
				archivedAt: null,
				email: { in: chunk, mode: "insensitive" },
			});
			for (const record of records) {
				existingByEmail.set((record.cells.email ?? "").toLowerCase(), record);
			}
			const rows = await this.db.suppressedContact.findMany({
				where: { email: { in: chunk, mode: "insensitive" } },
				select: { email: true },
			});
			for (const row of rows) suppressed.add(row.email.toLowerCase());
		}

		const lookup = await this.companyLookup(
			parsed.rows.map(({ data }) => data),
		);
		const seen = new Map<string, number>();

		for (const { line, data } of parsed.rows) {
			const first = seen.get(data.email);
			if (first !== undefined) {
				plan.errors.push({
					row: line.row,
					message: `${data.email} is already in row ${first}.`,
				});
				continue;
			}
			seen.set(data.email, line.row);

			const existing = existingByEmail.get(data.email);
			if (!existing && suppressed.has(data.email)) {
				plan.skipped.push({
					row: line.row,
					message: `${data.email} was removed from the CRM before. Add them by hand to allow them again.`,
				});
				continue;
			}

			const company = this.company(lookup, data);
			if (!company.ok) {
				plan.errors.push({ row: line.row, message: company.message });
				continue;
			}
			const owner = this.owner(data.ownerEmail, context);
			if (!owner.ok) {
				plan.errors.push({ row: line.row, message: owner.message });
				continue;
			}
			const values = this.fieldValues(line, existing?.cells, context);
			if (!values.ok) {
				plan.errors.push({ row: line.row, message: values.message });
				continue;
			}

			const current = existing?.cells ?? {};
			const patch: ContactUpdateInput = {};
			for (const column of CONTACT_TEXT) {
				const value = data[column];
				if (value !== undefined && value !== current[column]) {
					patch[column] = value;
				}
			}
			if (Object.keys(values.value).length > 0) patch.fields = values.value;

			if (!existing) {
				plan.ops.push({
					row: line.row,
					kind: "create",
					run: async () => {
						const created = await this.contacts.create(
							{
								firstName: data.firstName,
								email: data.email,
								companyId: company.value,
								ownerId: owner.value,
							},
							{ source: RecordSource.IMPORT },
						);
						if (Object.keys(patch).length > 0) {
							await this.contacts.update(created.id, patch);
						}
					},
				});
				continue;
			}

			if (data.firstName !== current.firstName) {
				patch.firstName = data.firstName;
			}
			if (company.value && company.value !== existing.companyId) {
				patch.companyId = company.value;
			}
			if (
				owner.value &&
				data.ownerEmail !== current.ownerEmail?.toLowerCase()
			) {
				patch.ownerId = owner.value;
			}
			if (Object.keys(patch).length === 0) {
				plan.skipped.push({ row: line.row, message: "Nothing changed." });
				continue;
			}
			plan.ops.push({
				row: line.row,
				kind: "update",
				run: async () => {
					await this.contacts.update(existing.id, patch);
				},
			});
		}

		return plan;
	}

	private async planDeals(lines: Line[], context: Context): Promise<Plan> {
		const parsed = this.parseRows<DealRow>(lines, dealRow);
		const plan: Plan = { ops: [], skipped: [], errors: parsed.errors };

		const lookup = await this.companyLookup(
			parsed.rows.map(({ data }) => data),
		);
		const companyIds = unique([
			...lookup.byDomain.values(),
			...[...lookup.byName.values()].flat(),
		]);
		const existingByKey = new Map<string, CsvRecord[]>();

		for (const chunk of chunked(companyIds)) {
			const records = await this.exporter.dealRecords({
				archivedAt: null,
				companyId: { in: chunk },
			});
			for (const record of records) {
				const key = dealKey(record.companyId, record.cells.name ?? "");
				existingByKey.set(key, [...(existingByKey.get(key) ?? []), record]);
			}
		}

		const seen = new Map<string, number>();

		for (const { line, data } of parsed.rows) {
			const company = this.company(lookup, data);
			if (!company.ok) {
				plan.errors.push({ row: line.row, message: company.message });
				continue;
			}
			if (!company.value) {
				plan.errors.push({
					row: line.row,
					message: "A deal needs a company. Fill companyDomain or companyName.",
				});
				continue;
			}

			const key = dealKey(company.value, data.name);
			const first = seen.get(key);
			if (first !== undefined) {
				plan.errors.push({
					row: line.row,
					message: `A deal called "${data.name}" at this company is already in row ${first}.`,
				});
				continue;
			}
			seen.set(key, line.row);

			const matches = existingByKey.get(key) ?? [];
			if (matches.length > 1) {
				plan.errors.push({
					row: line.row,
					message: `More than one deal called "${data.name}" exists at this company.`,
				});
				continue;
			}
			const existing = matches[0];
			const current = existing?.cells ?? {};

			const owner = this.owner(data.ownerEmail, context);
			if (!owner.ok) {
				plan.errors.push({ row: line.row, message: owner.message });
				continue;
			}
			const values = this.fieldValues(line, existing?.cells, context);
			if (!values.ok) {
				plan.errors.push({ row: line.row, message: values.message });
				continue;
			}

			const companyId = company.value;
			const patch: DealUpdateInput = {};
			if (
				data.description !== undefined &&
				data.description !== current.description
			) {
				patch.description = data.description;
			}
			if (Object.keys(values.value).length > 0) patch.fields = values.value;

			if (!existing) {
				plan.ops.push({
					row: line.row,
					kind: "create",
					run: async () => {
						const created = await this.deals.create({
							name: data.name,
							companyId,
							ownerId: owner.value ?? context.actingUserId,
							stage: data.stage,
							amountCents:
								data.amount === undefined
									? undefined
									: amountCentsOf(data.amount),
							currency: data.currency,
							expectedCloseDate: data.expectedCloseDate,
						});
						if (data.stage && isClosedStage(data.stage) && data.closedReason) {
							await this.db.deal.update({
								where: { id: created.id },
								data: { closedReason: data.closedReason },
							});
						}
						if (Object.keys(patch).length > 0) {
							await this.deals.update(created.id, patch);
						}
					},
				});
				continue;
			}

			if (data.amount !== undefined && data.amount !== current.amount) {
				patch.amountCents = amountCentsOf(data.amount);
			}
			if (data.currency !== undefined && data.currency !== current.currency) {
				patch.currency = data.currency;
			}
			if (
				data.expectedCloseDate !== undefined &&
				data.expectedCloseDate !== current.expectedCloseDate
			) {
				patch.expectedCloseDate = data.expectedCloseDate;
			}
			if (
				owner.value &&
				data.ownerEmail !== current.ownerEmail?.toLowerCase()
			) {
				patch.ownerId = owner.value;
			}
			const stage =
				data.stage !== undefined && data.stage !== current.stage
					? data.stage
					: undefined;
			if (Object.keys(patch).length === 0 && stage === undefined) {
				plan.skipped.push({ row: line.row, message: "Nothing changed." });
				continue;
			}
			plan.ops.push({
				row: line.row,
				kind: "update",
				run: async () => {
					if (Object.keys(patch).length > 0) {
						await this.deals.update(existing.id, patch);
					}
					if (stage) {
						await this.deals.setStage(
							{ id: existing.id, stage, closedReason: data.closedReason },
							context.actingUserId,
						);
					}
				},
			});
		}

		return plan;
	}

	private owner(
		email: string | undefined,
		context: Context,
	): Resolved<string | undefined> {
		if (email === undefined) return { ok: true, value: undefined };
		const id = context.users.get(email);
		return id
			? { ok: true, value: id }
			: {
					ok: false,
					message: `ownerEmail: nobody who works here has the email ${email}.`,
				};
	}

	private async companyLookup(
		rows: Array<{ companyDomain?: string; companyName?: string }>,
	): Promise<CompanyLookup> {
		const byDomain = new Map<string, string>();
		const byName = new Map<string, string[]>();

		for (const domains of chunked(
			unique(rows.map((row) => row.companyDomain)),
		)) {
			const found = await this.db.company.findMany({
				where: { archivedAt: null, domain: { in: domains } },
				select: { id: true, domain: true },
			});
			for (const company of found) {
				if (company.domain) byDomain.set(company.domain, company.id);
			}
		}
		for (const names of chunked(
			unique(
				rows.flatMap((row) =>
					row.companyDomain || !row.companyName
						? []
						: [row.companyName.toLowerCase()],
				),
			),
		)) {
			const found = await this.db.company.findMany({
				where: { archivedAt: null, name: { in: names, mode: "insensitive" } },
				select: { id: true, name: true },
			});
			for (const company of found) {
				const key = company.name.toLowerCase();
				byName.set(key, [...(byName.get(key) ?? []), company.id]);
			}
		}

		return { byDomain, byName };
	}

	private company(
		lookup: CompanyLookup,
		row: { companyDomain?: string; companyName?: string },
	): Resolved<string | undefined> {
		if (row.companyDomain) {
			const id = lookup.byDomain.get(row.companyDomain);
			return id
				? { ok: true, value: id }
				: {
						ok: false,
						message: `No company has the domain ${row.companyDomain}. Import the companies first.`,
					};
		}
		if (!row.companyName) return { ok: true, value: undefined };

		const ids = lookup.byName.get(row.companyName.toLowerCase()) ?? [];
		if (ids.length === 1) return { ok: true, value: ids[0] };
		return {
			ok: false,
			message:
				ids.length === 0
					? `No company is called "${row.companyName}". Import the companies first.`
					: `More than one company is called "${row.companyName}". Use its domain.`,
		};
	}

	private fieldValues(
		line: Line,
		existing: CsvRow | undefined,
		context: Context,
	): Resolved<FieldValues> {
		const values: FieldValues = {};

		for (const definition of context.definitions) {
			const value = line.fields[definition.key]?.trim() ?? "";
			if (value === "") continue;
			if (existing?.[FIELD_PREFIX + definition.key]?.trim() === value) continue;

			let input = value;
			if (definition.type === "USER") {
				const id = context.users.get(value.toLowerCase());
				if (!id) {
					return {
						ok: false,
						message: `${FIELD_PREFIX}${definition.key}: nobody who works here has the email ${value}.`,
					};
				}
				input = id;
			}

			try {
				coerceValue(definition, input);
			} catch (error) {
				if (error instanceof FieldValueError) {
					return {
						ok: false,
						message: `${FIELD_PREFIX}${definition.key}: ${error.message}`,
					};
				}
				throw error;
			}
			values[definition.key] = input;
		}

		return { ok: true, value: values };
	}

	private async apply(
		ops: Op[],
	): Promise<{ create: number; update: number; errors: RowNote[] }> {
		const result = { create: 0, update: 0, errors: [] as RowNote[] };

		for (const batch of chunked(ops)) {
			for (const op of batch) {
				try {
					await op.run();
					result[op.kind] += 1;
				} catch (error) {
					result.errors.push({
						row: op.row,
						message:
							error instanceof Error ? error.message : "Something went wrong.",
					});
				}
			}
		}

		return result;
	}
}

function dealKey(companyId: string | null, name: string): string {
	return `${companyId ?? ""}|${name.toLowerCase()}`;
}
