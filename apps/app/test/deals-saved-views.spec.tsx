import { describe, expect, it } from "bun:test";
import {
	NuqsTestingAdapter,
	type OnUrlUpdateFunction,
} from "nuqs/adapters/testing";
import { renderToStaticMarkup } from "react-dom/server";
import { dealsSearchParams } from "../app/(app)/[slug]/deals/deals-search-params";
import { DealsTable } from "../app/(app)/[slug]/deals/deals-table";
import {
	type TableQuery,
	useTableQuery,
} from "../components/data-table/use-table-query";
import { TRPCReactProvider } from "../lib/trpc/client";

const view = {
	q: "renewal",
	sort: "name",
	dir: "asc" as const,
	archived: true,
	filters: {
		status: ["open"],
		owner: ["user-1"],
		stage: ["PROPOSAL", "NEGOTIATION"],
		closing: ["this-month"],
	},
};

function capture(searchParams: string) {
	const updates: URLSearchParams[] = [];
	const onUrlUpdate: OnUrlUpdateFunction = ({ searchParams: next }) => {
		updates.push(next);
	};
	let table: TableQuery<"status", "owner" | "stage" | "closing"> | undefined;
	function Probe() {
		table = useTableQuery(dealsSearchParams);
		return null;
	}
	renderToStaticMarkup(
		<NuqsTestingAdapter
			searchParams={searchParams}
			onUrlUpdate={onUrlUpdate}
			processUrlSearchParams={(next) => next}
		>
			<Probe />
		</NuqsTestingAdapter>,
	);
	return { table, updates };
}

describe("deals saved views", () => {
	it("mounts the saved views menu on the deals list", () => {
		const html = renderToStaticMarkup(
			<NuqsTestingAdapter searchParams="">
				<TRPCReactProvider>
					<DealsTable />
				</TRPCReactProvider>
			</NuqsTestingAdapter>,
		);
		expect(html.includes("Views")).toBe(true);
	});

	it("captures q, sort, dir, archived, tab and facets from the URL", () => {
		const { table } = capture(
			"?q=renewal&sort=name&dir=asc&archived=true&status=open&owner=user-1&stage=PROPOSAL&stage=NEGOTIATION&closing=this-month",
		);
		expect(table?.currentView).toEqual(view);
	});

	it("applies a saved view to the URL, tab included", async () => {
		const { table, updates } = capture("");
		table?.applyView(view);
		await new Promise((resolve) => setTimeout(resolve, 100));
		const url = updates.at(-1);
		expect(url?.get("q")).toBe("renewal");
		expect(url?.get("sort")).toBe("name");
		expect(url?.get("dir")).toBe("asc");
		expect(url?.get("archived")).toBe("true");
		expect(url?.get("status")).toBe("open");
		expect(url?.getAll("owner")).toEqual(["user-1"]);
		expect(url?.getAll("stage")).toEqual(["PROPOSAL", "NEGOTIATION"]);
		expect(url?.getAll("closing")).toEqual(["this-month"]);
	});
});
