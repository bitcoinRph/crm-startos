import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { DealStage, db } from "@crm/db";
import { SETTINGS_ID, writeReportingCurrency } from "@crm/db/settings";
import { ConversionService } from "../src/currency/conversion.service";
import { DashboardService } from "../src/dashboard/dashboard.service";

const suffix = process.env.TEST_RUN_ID ?? "dashboard-forecast-spec";
const userId = `user-${suffix}`;
const domain = `forecast-${suffix}.test`;

const dashboard = new DashboardService(db, new ConversionService(db));

let companyId: string;
let previousReportingCurrency: string | null = null;

type DealSeed = {
	name: string;
	stage: DealStage;
	cents: number;
	archived?: boolean;
	currency?: string;
	closeOffsetMonths?: number;
};

async function deal({
	name,
	stage,
	cents,
	archived = false,
	currency = "USD",
	closeOffsetMonths,
}: DealSeed) {
	const now = new Date();
	const expectedCloseDate =
		closeOffsetMonths === undefined
			? null
			: new Date(now.getFullYear(), now.getMonth() + closeOffsetMonths, 15);
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
			expectedCloseDate,
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
			name: "Forecast Tester",
			email: `owner@${domain}`,
			emailVerified: true,
		},
		update: {},
	});
	const company = await db.company.upsert({
		where: { domain },
		create: { name: `Forecast Co ${suffix}`, domain },
		update: {},
		select: { id: true },
	});
	companyId = company.id;

	await deal({ name: "Demo one", stage: DealStage.DEMO_BOOKED, cents: 105 });
	await deal({ name: "Demo two", stage: DealStage.DEMO_BOOKED, cents: 105 });
	await deal({
		name: "Qualified",
		stage: DealStage.QUALIFIED_TO_BUY,
		cents: 200_00,
	});
	await deal({
		name: "Decision",
		stage: DealStage.DECISION_MAKER_BOUGHT_IN,
		cents: 300_00,
	});
	await deal({
		name: "Contract due",
		stage: DealStage.CONTRACT_SENT,
		cents: 400_00,
		closeOffsetMonths: 0,
	});
	await deal({
		name: "Contract later",
		stage: DealStage.CONTRACT_SENT,
		cents: 100_00,
		closeOffsetMonths: 1,
	});
	await deal({
		name: "Contract foreign",
		stage: DealStage.CONTRACT_SENT,
		cents: 900_00,
		currency: "CHF",
		closeOffsetMonths: 0,
	});
	await deal({
		name: "Contract archived",
		stage: DealStage.CONTRACT_SENT,
		cents: 700_00,
		archived: true,
		closeOffsetMonths: 0,
	});
	await deal({ name: "Won", stage: DealStage.CLOSED_WON, cents: 800_00 });
	await deal({ name: "Lost", stage: DealStage.CLOSED_LOST, cents: 600_00 });
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

describe("the dashboard forecast", () => {
	it("applies each stage probability to the converted open value", async () => {
		const { forecast } = await dashboard.summary(userId, { scope: "me" });

		expect(forecast.stages).toEqual([
			{ stage: DealStage.DEMO_BOOKED, probability: 0.1, weightedCents: 21 },
			{
				stage: DealStage.QUALIFIED_TO_BUY,
				probability: 0.3,
				weightedCents: 60_00,
			},
			{
				stage: DealStage.DECISION_MAKER_BOUGHT_IN,
				probability: 0.6,
				weightedCents: 180_00,
			},
			{
				stage: DealStage.CONTRACT_SENT,
				probability: 0.8,
				weightedCents: 400_00,
			},
		]);
		expect(forecast.totalCents).toBe(21 + 60_00 + 180_00 + 400_00);
	});

	it("rounds once per stage, so the stage rows add up to the total", async () => {
		const { forecast } = await dashboard.summary(userId, { scope: "me" });

		expect(forecast.stages[0]?.weightedCents).toBe(21);
		expect(forecast.totalCents).toBe(
			forecast.stages.reduce((sum, row) => sum + row.weightedCents, 0),
		);
	});

	it("weights only deals expected to close this month", async () => {
		const { forecast } = await dashboard.summary(userId, { scope: "me" });

		expect(forecast.closingThisMonthCents).toBe(320_00);
	});

	it("leaves out unconverted, archived and closed deals", async () => {
		const summary = await dashboard.summary(userId, { scope: "me" });

		expect(summary.unconverted.count).toBe(1);
		expect(summary.unconverted.currencies).toEqual(["CHF"]);
		expect(summary.forecast.totalCents).toBe(21 + 60_00 + 180_00 + 400_00);
	});
});
