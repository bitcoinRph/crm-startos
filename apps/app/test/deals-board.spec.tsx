import { describe, expect, it, mock } from "bun:test";
import { useQueryClient } from "@tanstack/react-query";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { renderToStaticMarkup } from "react-dom/server";
import {
	dealsBoardInput,
	dealsSearchParams,
	dealsViewLoader,
} from "../app/(app)/[slug]/deals/deals-search-params";
import { DealsTable } from "../app/(app)/[slug]/deals/deals-table";
import { applyStageMoves, dropDeal } from "../lib/deal-board";
import { DEAL_BOARD } from "../lib/deal-board-config";
import { TRPCReactProvider, useTRPC } from "../lib/trpc/client";
import type { RouterOutputs } from "../lib/trpc/types";

type DealList = RouterOutputs["deals"]["list"];
type DealRow = DealList["rows"][number];

function deal(
	id: string,
	name: string,
	stage: DealRow["stage"],
	companyName: string,
	amountCents: number | null,
): DealRow {
	return {
		id,
		name,
		stage,
		amountCents,
		currency: "USD",
		company: {
			id: `company-${id}`,
			name: companyName,
			domain: null,
			iconUrl: null,
		},
	} as DealRow;
}

const rows = [
	deal("d1", "Alpha rollout", "DEMO_BOOKED", "Acme", 125000),
	deal("d2", "Beta pilot", "QUALIFIED_TO_BUY", "Globex", null),
	deal("d3", "Gamma renewal", "QUALIFIED_TO_BUY", "Initech", 50000),
	deal("d4", "Delta expansion", "CONTRACT_SENT", "Umbrella", 990000),
];

function Seed({ total }: { total: number }) {
	const trpc = useTRPC();
	const client = useQueryClient();
	client.setQueryData(
		trpc.deals.list.queryKey(dealsBoardInput(dealsSearchParams.defaultInput())),
		{ rows, total, facetCounts: {} } as DealList,
	);
	client.setQueryData(
		trpc.deals.stageValues.queryKey(
			dealsBoardInput(dealsSearchParams.defaultInput()),
		),
		{
			reportingCurrency: "USD",
			stages: [
				{ stage: "DEMO_BOOKED", valueCents: 125000, unconverted: 0 },
				{ stage: "QUALIFIED_TO_BUY", valueCents: 50000, unconverted: 2 },
				{ stage: "DECISION_MAKER_BOUGHT_IN", valueCents: 0, unconverted: 0 },
				{ stage: "CONTRACT_SENT", valueCents: 990000, unconverted: 0 },
			],
		},
	);
	return <DealsTable />;
}

function render(searchParams: string, total = rows.length) {
	return renderToStaticMarkup(
		<NuqsTestingAdapter searchParams={searchParams}>
			<TRPCReactProvider>
				<Seed total={total} />
			</TRPCReactProvider>
		</NuqsTestingAdapter>,
	);
}

function column(html: string, stage: string): string {
	const start = html.indexOf(`data-board-column="${stage}"`);
	expect(start).toBeGreaterThan(-1);
	const next = html.indexOf("data-board-column=", start + 1);
	return html.slice(start, next === -1 ? undefined : next);
}

describe("deals board view", () => {
	it("renders one column per open stage with its deals", () => {
		const html = render("?view=board");
		expect(html.match(/data-board-column="/g)?.length).toBe(4);
		expect(html).not.toContain('data-board-column="CLOSED_WON"');
		expect(html).not.toContain('data-board-column="CLOSED_LOST"');

		const demo = column(html, "DEMO_BOOKED");
		expect(demo).toContain("Alpha rollout");
		expect(demo).toContain("Acme");
		expect(demo).toContain("$1,250");
		expect(demo).not.toContain("Beta pilot");

		const qualified = column(html, "QUALIFIED_TO_BUY");
		expect(qualified).toContain("Beta pilot");
		expect(qualified).toContain("Gamma renewal");

		expect(column(html, "DECISION_MAKER_BOUGHT_IN")).not.toContain("rollout");
		expect(column(html, "CONTRACT_SENT")).toContain("Delta expansion");
		expect(html).not.toContain("Showing the first");
	});

	it("names each card and column for keyboards and automation", () => {
		const html = render("?view=board");
		expect(html).toContain('data-board-item="d1"');
		expect(html).toContain('data-stage="DEMO_BOOKED"');
		expect(html).toContain('aria-label="Open Alpha rollout"');
		expect(html).toContain('aria-label="Deals by stage"');
		expect(html).toContain('aria-label="View"');
		expect(html).toContain('data-count="2"');
	});

	it("shows each column's value in the reporting currency and what it leaves out", () => {
		const html = render("?view=board");
		expect(column(html, "DEMO_BOOKED")).toContain("$1,250");
		expect(column(html, "QUALIFIED_TO_BUY")).toContain("2 not counted");
		expect(column(html, "CONTRACT_SENT")).not.toContain("not counted");
		expect(html.match(/data-slot="board-column-summary"/g)?.length).toBe(4);
	});

	it("shows a drop hint in an empty column", () => {
		const html = render("?view=board");
		expect(column(html, "DECISION_MAKER_BOUGHT_IN")).toContain(
			"Drop a deal here.",
		);
		expect(column(html, "DEMO_BOOKED")).not.toContain("Drop a deal here.");
	});

	it("marks cards draggable", () => {
		expect(render("?view=board")).toContain('draggable="true"');
	});

	it("says when the board shows only the first deals", () => {
		const html = render("?view=board", DEAL_BOARD.pageSize + 40);
		expect(html).toContain(
			`Showing the first ${rows.length} of ${DEAL_BOARD.pageSize + 40} open deals.`,
		);
	});

	it("renders the table by default", () => {
		const html = render("");
		expect(html).not.toContain("data-board-column");
	});

	it("asks the board query for open deals at the page size maximum", () => {
		const input = dealsBoardInput(dealsSearchParams.defaultInput());
		expect(input.status).toBe("open");
		expect(input.pageSize).toBe(100);
		expect(input.page).toBe(1);
		expect(input.archived).toBe(false);
	});
});

describe("dropDeal", () => {
	it("calls setStage with the id and the target stage", () => {
		const setStage = mock();
		dropDeal({
			dealId: "d1",
			target: "CONTRACT_SENT",
			rows,
			setStage,
		});
		expect(setStage).toHaveBeenCalledTimes(1);
		expect(setStage).toHaveBeenCalledWith({
			id: "d1",
			stage: "CONTRACT_SENT",
		});
	});

	it("does nothing when the deal is already in the target stage", () => {
		const setStage = mock();
		dropDeal({ dealId: "d1", target: "DEMO_BOOKED", rows, setStage });
		expect(setStage).not.toHaveBeenCalled();
	});

	it("does nothing for an unknown deal or a closed target", () => {
		const setStage = mock();
		dropDeal({ dealId: "nope", target: "CONTRACT_SENT", rows, setStage });
		dropDeal({ dealId: "d1", target: "CLOSED_LOST", rows, setStage });
		expect(setStage).not.toHaveBeenCalled();
	});
});

describe("view search param", () => {
	it("parses board", async () => {
		const values = await dealsViewLoader("?view=board");
		expect(values.view).toBe("board");
	});

	it("defaults to table", async () => {
		expect((await dealsViewLoader("")).view).toBe("table");
		expect((await dealsViewLoader("?view=nonsense")).view).toBe("table");
	});
});

describe("applyStageMoves", () => {
	it("moves a dropped deal before the server answers", () => {
		const moved = applyStageMoves(rows, new Map([["d1", "CONTRACT_SENT"]]));
		expect(moved.find((row) => row.id === "d1")?.stage).toBe("CONTRACT_SENT");
		expect(moved.find((row) => row.id === "d2")?.stage).toBe(
			"QUALIFIED_TO_BUY",
		);
		expect(rows[0]?.stage).toBe("DEMO_BOOKED");
	});

	it("returns the rows unchanged when nothing is in flight", () => {
		expect(applyStageMoves(rows, new Map())).toEqual(rows);
	});
});
