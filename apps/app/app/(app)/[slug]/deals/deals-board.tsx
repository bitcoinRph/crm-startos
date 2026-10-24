"use client";

import { Board, BoardCard, BoardColumn } from "@crm/ui/components/board";
import { formatMoney } from "@crm/ui/lib/format";
import { CompanyCell } from "@/components/crm/company-cell";
import { usePrefetchRecord } from "@/components/crm/record-sheet/record-prefetch";
import { useOpenRecord } from "@/components/crm/record-sheet/record-stack";
import { DealStageMenu, useStageMutation } from "@/components/crm/stage-change";
import { dropDeal, groupDealsByStage } from "@/lib/deal-board";
import { DEAL_BOARD } from "@/lib/deal-board-config";
import { dealStageLabel, OPEN_STAGES } from "@/lib/deal-stage";
import type { RouterOutputs } from "@/lib/trpc/types";

type DealRow = RouterOutputs["deals"]["list"]["rows"][number];

export function DealsBoard({
	rows,
	total,
}: {
	rows: DealRow[];
	total: number;
}) {
	const openRecord = useOpenRecord();
	const prefetchRecord = usePrefetchRecord();
	const setStage = useStageMutation();
	const groups = groupDealsByStage(rows, OPEN_STAGES);

	return (
		<>
			{total > rows.length ? (
				<p className="text-xs text-muted-foreground">
					Showing the first {rows.length} of {total} open deals. Narrow the
					filters to see the rest.
				</p>
			) : null}
			<Board>
				{OPEN_STAGES.map((stage) => {
					const deals = groups.get(stage) ?? [];
					return (
						<BoardColumn
							key={stage}
							columnId={stage}
							title={dealStageLabel(stage)}
							count={deals.length}
							dragType={DEAL_BOARD.dragType}
							onDropItem={(dealId) =>
								dropDeal({
									dealId,
									target: stage,
									rows,
									setStage: setStage.mutate,
								})
							}
						>
							{deals.map((deal) => (
								<BoardCard
									key={deal.id}
									itemId={deal.id}
									dragType={DEAL_BOARD.dragType}
									onOpen={() => openRecord({ kind: "deal", id: deal.id })}
									onHover={() => prefetchRecord({ kind: "deal", id: deal.id })}
									actions={
										<DealStageMenu
											dealId={deal.id}
											stage={deal.stage}
											variant="control"
										/>
									}
								>
									<span className="w-full truncate font-medium">
										{deal.name}
									</span>
									<CompanyCell company={deal.company} />
									{deal.amountCents === null ? null : (
										<span className="tabular-nums">
											{formatMoney(deal.amountCents, deal.currency)}
										</span>
									)}
								</BoardCard>
							))}
						</BoardColumn>
					);
				})}
			</Board>
		</>
	);
}
