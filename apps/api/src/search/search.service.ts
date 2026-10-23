import { type Db, Prisma } from "@crm/db";
import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { normalizeDomain } from "../companies/domain";
import { normalizeEmail } from "../crm/values";
import { InjectDatabase } from "../database/database.constants";
import { archivedFilter } from "../trpc/list-input";
import type {
	ResolveCustomerInput,
	ResolveCustomerResult,
} from "./search.contracts";
import { customerContactRows } from "./search.contracts";
import { SEARCH } from "./search-config";

export type SearchHit = {
	kind: "company" | "contact" | "deal";
	id: string;
	label: string;
	detail: string | null;
	iconUrl: string | null;
	iconDarkUrl: string | null;
	iconTone: string | null;
	imageUrl: string | null;
};

const PER_KIND = 5;

@Injectable()
export class SearchService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async resolveCustomer(
		input: ResolveCustomerInput,
	): Promise<ResolveCustomerResult> {
		let matches: ResolveCustomerResult["matches"];
		if (input.email !== undefined) {
			const email = normalizeEmail(input.email);
			if (!email || !z.email().safeParse(email).success) {
				return { status: "invalid", matches: [], truncated: false };
			}
			const archived = input.archived
				? Prisma.sql`"archivedAt" IS NOT NULL`
				: Prisma.sql`"archivedAt" IS NULL`;
			const rows = customerContactRows.parse(
				await this.db.$queryRaw`
				SELECT "id", "firstName", "lastName", "email", "companyId", "archivedAt"
				FROM "contact"
				WHERE lower("email") = ${email} AND ${archived}
				ORDER BY "id" ASC LIMIT ${SEARCH.resolve.maxMatches + 1}
			`,
			);
			matches = rows.map((row) => ({
				...row,
				kind: "contact",
				matchType: row.email === input.email ? "exact" : "case_insensitive",
				archivedAt: row.archivedAt?.toISOString() ?? null,
			}));
		} else {
			const domain = normalizeDomain(input.domain);
			if (!domain) return { status: "invalid", matches: [], truncated: false };
			const rows = await this.db.company.findMany({
				where: { ...archivedFilter(input.archived), domain },
				orderBy: { id: "asc" },
				take: SEARCH.resolve.maxMatches + 1,
				select: { id: true, name: true, domain: true, archivedAt: true },
			});
			matches = rows.map((row) => ({
				...row,
				kind: "company",
				matchType: "exact",
				archivedAt: row.archivedAt?.toISOString() ?? null,
			}));
		}
		return {
			status:
				matches.length === 0
					? "not_found"
					: matches.length === 1
						? "resolved"
						: "ambiguous",
			matches: matches.slice(0, SEARCH.resolve.maxMatches),
			truncated: matches.length > SEARCH.resolve.maxMatches,
		};
	}

	async quick(q: string): Promise<{ hits: SearchHit[] }> {
		const term = q.trim();
		if (term.length < 2) return { hits: [] };

		const [companies, contacts, deals] = await Promise.all([
			this.db.company.findMany({
				where: {
					archivedAt: null,
					OR: [
						{ name: { contains: term, mode: "insensitive" } },
						{ domain: { contains: term, mode: "insensitive" } },
					],
				},
				take: PER_KIND,
				orderBy: { name: "asc" },
				select: {
					id: true,
					name: true,
					domain: true,
					iconUrl: true,
					iconDarkUrl: true,
					iconTone: true,
				},
			}),
			this.db.contact.findMany({
				where: {
					archivedAt: null,
					OR: [
						{ firstName: { contains: term, mode: "insensitive" } },
						{ lastName: { contains: term, mode: "insensitive" } },
						{ email: { contains: term, mode: "insensitive" } },
					],
				},
				take: PER_KIND,
				orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
				select: {
					id: true,
					firstName: true,
					lastName: true,
					email: true,
					imageUrl: true,
					company: { select: { name: true } },
				},
			}),
			this.db.deal.findMany({
				where: {
					archivedAt: null,
					name: { contains: term, mode: "insensitive" },
				},
				take: PER_KIND,
				orderBy: [{ stage: "asc" }, { name: "asc" }],
				select: {
					id: true,
					name: true,
					company: {
						select: {
							name: true,
							iconUrl: true,
							iconDarkUrl: true,
							iconTone: true,
						},
					},
				},
			}),
		]);

		return {
			hits: [
				...companies.map(
					(company): SearchHit => ({
						kind: "company",
						id: company.id,
						label: company.name,
						detail: company.domain,
						iconUrl: company.iconUrl,
						iconDarkUrl: company.iconDarkUrl,
						iconTone: company.iconTone,
						imageUrl: null,
					}),
				),
				...contacts.map(
					(contact): SearchHit => ({
						kind: "contact",
						id: contact.id,
						label:
							[contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
							(contact.email ?? "Unnamed"),
						detail: contact.company?.name ?? contact.email,
						iconUrl: null,
						iconDarkUrl: null,
						iconTone: null,
						imageUrl: contact.imageUrl,
					}),
				),
				...deals.map(
					(deal): SearchHit => ({
						kind: "deal",
						id: deal.id,
						label: deal.name,
						detail: deal.company.name,
						iconUrl: deal.company.iconUrl,
						iconDarkUrl: deal.company.iconDarkUrl,
						iconTone: deal.company.iconTone,
						imageUrl: null,
					}),
				),
			],
		};
	}
}
