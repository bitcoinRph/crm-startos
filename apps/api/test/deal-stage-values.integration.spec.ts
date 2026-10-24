import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import { SETTINGS_ID, writeReportingCurrency } from "@crm/db/settings";
import type { AgentTriggerService } from "../src/agent/agent-trigger.service";
import { ActivityStampService } from "../src/crm/activity-stamp.service";
import { ConversionService } from "../src/currency/conversion.service";
import { DealsService } from "../src/deals/deals.service";
import { FieldsService } from "../src/fields/fields.service";
import { withDiscardedCrmEvents } from "./agent-trigger.stub";

const suffix = process.env.TEST_RUN_ID ?? "deal-stage-values-spec";
const userId = `user-${suffix}`;
const domain = `stages-${suffix}.test`;
const UNRATED = "XTS";

const agent = {
	withCrmEvents: withDiscardedCrmEvents,
} as unknown as AgentTriggerService;

const conversion = new ConversionService(db);
const deals = new DealsService(
	db,
	agent,
	new ActivityStampService(db),
	conversion,
	new FieldsService(db, { fieldBackfill: async () => undefined } as never),
);

let companyId: string;
let previousReportingCurrency: string | null = null;

const listInput = {
	q: "",
	page: 1,
	pageSize: 25,
	sort: "",
	dir: "desc" as const,
	status: "open" as const,
	owner: [] as string[],
	stage: [],
	closing: [],
	fields: {},
	archived: false,
};

async function deal(
	name: string,
	amountCents: number,
	currency: string,
	stage: "DEMO_BOOKED" | "CONTRACT_SENT" | "CLOSED_WON",
) {
	const created = await deals.create({
		name: `${name} ${suffix}`,
		companyId,
		ownerId: userId,
		amountCents,
		currency,
	});
	await db.deal.update({ where: { id: created.id }, data: { stage } });
}

beforeAll(async () => {
	const existing = await db.appSetting.findUnique({
		where: { id: SETTINGS_ID },
		select: { reportingCurrency: true },
	});
	previousReportingCurrency = existing?.reportingCurrency ?? null;
	await writeReportingCurrency(db, "USD");

	expect(
		await db.exchangeRate.count({ where: { quoteCurrency: UNRATED } }),
	).toBe(0);

	await db.user.upsert({
		where: { id: userId },
		create: {
			id: userId,
			name: "Stage Values Tester",
			email: `stages@${domain}`,
			emailVerified: true,
		},
		update: {},
	});
	const company = await db.company.upsert({
		where: { domain },
		create: { name: `Stage Co ${suffix}`, domain },
		update: {},
		select: { id: true },
	});
	companyId = company.id;

	await deal("Demo one", 100_000, "USD", "DEMO_BOOKED");
	await deal("Demo two", 25_000, "USD", "DEMO_BOOKED");
	await deal("Demo unrated", 999_000, UNRATED, "DEMO_BOOKED");
	await deal("Contract", 70_000, "USD", "CONTRACT_SENT");
	await deal("Won", 500_000, "USD", "CLOSED_WON");
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

describe("the value of each open stage", () => {
	it("sums only converted amounts per open stage and counts the rest", async () => {
		const values = await deals.stageValues({ ...listInput, owner: [userId] });

		expect(values.reportingCurrency).toBe("USD");
		expect(values.stages).toEqual([
			{ stage: "DEMO_BOOKED", valueCents: 125_000, unconverted: 1 },
			{ stage: "QUALIFIED_TO_BUY", valueCents: 0, unconverted: 0 },
			{ stage: "DECISION_MAKER_BOUGHT_IN", valueCents: 0, unconverted: 0 },
			{ stage: "CONTRACT_SENT", valueCents: 70_000, unconverted: 0 },
		]);
	});

	it("follows the same filters as the list", async () => {
		const values = await deals.stageValues({
			...listInput,
			owner: [userId],
			q: `Contract ${suffix}`,
		});

		expect(values.stages.find((s) => s.stage === "DEMO_BOOKED")).toEqual({
			stage: "DEMO_BOOKED",
			valueCents: 0,
			unconverted: 0,
		});
		expect(
			values.stages.find((s) => s.stage === "CONTRACT_SENT")?.valueCents,
		).toBe(70_000);
	});
});
