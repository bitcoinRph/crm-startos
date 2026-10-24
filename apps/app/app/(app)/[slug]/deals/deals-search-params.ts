import { createLoader, parseAsStringLiteral } from "nuqs/server";
import { createListSearchParams } from "@/components/data-table/list-search-params";
import { DEAL_BOARD } from "@/lib/deal-board-config";
import { SEARCH_PARAM } from "@/lib/search-param-keys";

export const dealsSearchParams = createListSearchParams({
	defaultSort: "createdAt",
	defaultDir: "desc",
	tabId: "status",
	facetIds: ["owner", "stage", "closing"] as const,
});

export const DEALS_VIEWS = ["table", "board"] as const;

export type DealsView = (typeof DEALS_VIEWS)[number];

export const dealsViewParsers = {
	[SEARCH_PARAM.list.view]:
		parseAsStringLiteral(DEALS_VIEWS).withDefault("table"),
};

export const dealsViewLoader = createLoader(dealsViewParsers);

export function dealsBoardInput(
	input: ReturnType<typeof dealsSearchParams.toInput>,
) {
	return {
		...input,
		status: "open",
		page: 1,
		pageSize: DEAL_BOARD.pageSize,
		archived: false,
	};
}
