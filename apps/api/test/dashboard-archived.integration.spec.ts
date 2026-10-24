import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { DealStage, db } from "@crm/db";
import { SETTINGS_ID, writeReportingCurrency } from "@crm/db/settings";
import { ConversionService } from "../src/currency/conversion.service";
import { DashboardService } from "../src/dashboard/dashboard.service";

const suffix = process.env.TEST_RUN_ID ?? "dashboard-archived-spec";
const userId = `user-${suffix}`;
const domain = `archived-${suffix}.test`;

const dashboard = new DashboardService(db, new ConversionService(db));

let companyId: string;
let previousReportingCurrency: string | null = null;

async function deal(
	name: string,
	stage: DealStage,
	cents: number,
	archived: boolean,
	currency = "USD",
) {
	const now = new Date();
	await db.deal.create({
		data: {
			name: `${name} ${suffix}`,
			companyId,
			ownerId: userId,
			stage,
			amount: cents / 100,
			currency,
			baseAmount: currency === "USD" ? cents / 100 : null,
			baseCurrency: currency === "USD" ? "USD" : null,
			closedAt: stage === DealStage.CLOSED_WON ? now : null,
			archivedAt: archived ? now : null,
		},
	});
}

beforeAll(async () => {
	const existing = await db.appSetting.findUnique({
		where: { id: SETTINGS_ID },
		select: { reportingCurrency: true },
	});
	previousReportingCurrency = existing?.reportingCurrency ?? null;
	await writeReportingCurrency(db, "USD");

	await db.user.upsert({
		where: { id: userId },
		create: {
			id: userId,
			name: "Archive Tester",
			email: `owner@${domain}`,
			emailVerified: true,
		},
		update: {},
	});
	const company = await db.company.upsert({
		where: { domain },
		create: { name: `Archive Co ${suffix}`, domain },
		update: {},
		select: { id: true },
	});
	companyId = company.id;

	await deal("Open active", DealStage.DEMO_BOOKED, 100_00, false);
	await deal("Open archived", DealStage.DEMO_BOOKED, 900_00, true);
	await deal("Won active", DealStage.CLOSED_WON, 200_00, false);
	await deal("Won archived", DealStage.CLOSED_WON, 800_00, true);
	await deal("Foreign archived", DealStage.DEMO_BOOKED, 500_00, true, "CHF");
});

afterAll(async () => {
	await db.deal.deleteMany({ where: { companyId } });
	await db.company.deleteMany({ where: { domain } });
	await db.user.deleteMany({ where: { id: userId } });
	if (previousReportingCurrency) {
		await writeReportingCurrency(db, previousReportingCurrency);
	} else {
		await db.appSetting.updateMany({ data: { reportingCurrency: null } });
	}
});

describe("the dashboard summary", () => {
	it("leaves archived deals out of every total", async () => {
		const summary = await dashboard.summary(userId, { scope: "me" });

		expect(summary.pipeline.totalDeals).toBe(1);
		expect(summary.pipeline.totalCents).toBe(100_00);
		expect(summary.wonThisMonth).toEqual({ count: 1, valueCents: 200_00 });
		expect(summary.performance.wins).toBe(1);
		expect(summary.biggestOpen.map((row) => row.name)).toEqual([
			`Open active ${suffix}`,
		]);
		expect(summary.unconverted.count).toBe(0);
	});
});
