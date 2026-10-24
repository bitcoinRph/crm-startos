import { type Db, type FieldEntity, type Prisma } from "@crm/db";
import {
	type FieldDefinitionWithOptions,
	type FieldValueJson,
	readValue,
	recordColumn,
} from "@crm/db/fields";
import { Injectable, Logger } from "@nestjs/common";
import { type CsvRow, writeCsv } from "../crm/csv";
import { InjectDatabase } from "../database/database.constants";
import { FieldsService } from "../fields/fields.service";
import { CSV_COLUMNS, type CsvEntity, FIELD_PREFIX } from "./csv-columns";
import { CSV } from "./csv-config";

export type CsvRecord = { id: string; cells: CsvRow };

type ExportLimits = { maxRows: number; pageSize: number };

export type CsvExport = {
	entity: CsvEntity;
	filename: string;
	csv: string;
	rows: number;
	truncated: boolean;
};

const OWNER_SELECT = { select: { email: true } } as const;
const COMPANY_SELECT = { select: { domain: true, name: true } } as const;

const FIELD_ENTITIES = {
	companies: "COMPANY",
	contacts: "CONTACT",
	deals: "DEAL",
} as const satisfies Record<CsvEntity, FieldEntity>;

const MIDNIGHT_UTC = "T00:00:00.000Z";

export function dateCell(value: Date | null): string {
	if (!value) return "";
	const iso = value.toISOString();
	return iso.endsWith(MIDNIGHT_UTC) ? iso.slice(0, 10) : iso;
}

function text(value: string | null): string {
	return value ?? "";
}

@Injectable()
export class CsvExportService {
	private readonly logger = new Logger(CsvExportService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly fields: FieldsService,
	) {}

	async export(
		entity: CsvEntity,
		limits: ExportLimits = CSV.export,
	): Promise<CsvExport> {
		const { maxRows, pageSize } = limits;
		const definitions = await this.fields.definitionsFor(
			FIELD_ENTITIES[entity],
		);
		const columns = [
			...CSV_COLUMNS[entity],
			...definitions.map((definition) => FIELD_PREFIX + definition.key),
		];

		const rows: CsvRow[] = [];
		let after = "";
		let truncated = false;

		while (!truncated) {
			const page = await this.page(entity, after, pageSize);
			const room = maxRows - rows.length;
			for (const record of page.slice(0, room)) rows.push(record.cells);
			truncated = page.length > room;
			const last = page.at(-1);
			if (!last || page.length < pageSize) break;
			after = last.id;
		}

		this.logger.log({ message: "CSV exported", entity, rows: rows.length });

		return {
			entity,
			filename: `${entity}.csv`,
			csv: writeCsv(columns, rows),
			rows: rows.length,
			truncated,
		};
	}

	async companyRecords(
		where: Prisma.CompanyWhereInput,
		take?: number,
	): Promise<CsvRecord[]> {
		const rows = await this.db.company.findMany({
			where,
			take,
			orderBy: { id: "asc" },
			include: { owner: OWNER_SELECT },
		});
		return this.withFields(
			"companies",
			rows.map((row) => ({
				id: row.id,
				cells: {
					id: row.id,
					name: row.name,
					domain: text(row.domain),
					website: text(row.website),
					description: text(row.description),
					industry: text(row.industry),
					city: text(row.city),
					stateCode: text(row.stateCode),
					country: text(row.country),
					phone: text(row.phone),
					email: text(row.email),
					linkedinUrl: text(row.linkedinUrl),
					ownerEmail: text(row.owner?.email ?? null),
					source: row.source,
					createdAt: row.createdAt.toISOString(),
				},
			})),
		);
	}

	async contactRecords(
		where: Prisma.ContactWhereInput,
		take?: number,
	): Promise<CsvRecord[]> {
		const rows = await this.db.contact.findMany({
			where,
			take,
			orderBy: { id: "asc" },
			include: { owner: OWNER_SELECT, company: COMPANY_SELECT },
		});
		return this.withFields(
			"contacts",
			rows.map((row) => ({
				id: row.id,
				cells: {
					id: row.id,
					firstName: row.firstName,
					lastName: text(row.lastName),
					email: text(row.email),
					phone: text(row.phone),
					title: text(row.title),
					linkedinUrl: text(row.linkedinUrl),
					twitterUrl: text(row.twitterUrl),
					githubUrl: text(row.githubUrl),
					companyDomain: text(row.company?.domain ?? null),
					companyName: text(row.company?.name ?? null),
					ownerEmail: text(row.owner?.email ?? null),
					source: row.source,
					createdAt: row.createdAt.toISOString(),
				},
			})),
		);
	}

	async dealRecords(
		where: Prisma.DealWhereInput,
		take?: number,
	): Promise<CsvRecord[]> {
		const rows = await this.db.deal.findMany({
			where,
			take,
			orderBy: { id: "asc" },
			include: { owner: OWNER_SELECT, company: COMPANY_SELECT },
		});
		return this.withFields(
			"deals",
			rows.map((row) => ({
				id: row.id,
				cells: {
					id: row.id,
					name: row.name,
					description: text(row.description),
					companyDomain: text(row.company.domain),
					companyName: row.company.name,
					stage: row.stage,
					closedReason: text(row.closedReason),
					amount: row.amount?.toFixed(2) ?? "",
					currency: row.currency,
					expectedCloseDate: dateCell(row.expectedCloseDate),
					ownerEmail: row.owner.email,
					createdAt: row.createdAt.toISOString(),
				},
			})),
		);
	}

	private page(
		entity: CsvEntity,
		after: string,
		take: number,
	): Promise<CsvRecord[]> {
		const where = { archivedAt: null, id: { gt: after } };
		switch (entity) {
			case "companies":
				return this.companyRecords(where, take);
			case "contacts":
				return this.contactRecords(where, take);
			case "deals":
				return this.dealRecords(where, take);
		}
	}

	private async withFields(
		entity: CsvEntity,
		records: CsvRecord[],
	): Promise<CsvRecord[]> {
		const fieldCells = await this.fieldCells(
			FIELD_ENTITIES[entity],
			records.map((record) => record.id),
		);
		return records.map((record) => ({
			id: record.id,
			cells: { ...record.cells, ...fieldCells.get(record.id) },
		}));
	}

	private async fieldCells(
		entity: FieldEntity,
		ids: string[],
	): Promise<Map<string, CsvRow>> {
		const byRecord = new Map<string, CsvRow>();
		const definitions = await this.fields.definitionsFor(entity);
		if (definitions.length === 0 || ids.length === 0) return byRecord;

		const column = recordColumn(entity);
		const [values, users] = await Promise.all([
			this.db.fieldValue.findMany({
				where: {
					[column]: { in: ids },
					fieldId: { in: definitions.map((definition) => definition.id) },
				},
			}),
			this.db.user.findMany({ select: { id: true, email: true } }),
		]);
		const emails = new Map(users.map((user) => [user.id, user.email]));
		const byId = new Map(
			definitions.map((definition) => [definition.id, definition]),
		);

		for (const value of values) {
			const recordId = value[column];
			const definition = byId.get(value.fieldId);
			if (!recordId || !definition) continue;

			const cells = byRecord.get(recordId) ?? {};
			cells[FIELD_PREFIX + definition.key] = fieldCell(
				definition,
				readValue(definition, value),
				emails,
			);
			byRecord.set(recordId, cells);
		}

		return byRecord;
	}
}

function fieldCell(
	definition: FieldDefinitionWithOptions,
	value: FieldValueJson,
	emails: Map<string, string>,
): string {
	if (value === null) return "";
	switch (definition.type) {
		case "SELECT":
			return (
				definition.options.find((option) => option.id === value)?.label ?? ""
			);
		case "USER":
			return emails.get(String(value)) ?? "";
		case "DATE":
			return dateCell(new Date(String(value)));
		default:
			return String(value);
	}
}
