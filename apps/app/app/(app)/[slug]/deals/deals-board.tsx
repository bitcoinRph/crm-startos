"use client";

import { Board, BoardCard, BoardColumn } from "@crm/ui/components/board";
import { formatMoney } from "@crm/ui/lib/format";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { CompanyCell } from "@/components/crm/company-cell";
import { usePrefetchRecord } from "@/components/crm/record-sheet/record-prefetch";
import { useOpenRecord } from "@/components/crm/record-sheet/record-stack";
import { DealStageMenu, useStageMutation } from "@/components/crm/stage-change";
import { applyStageMoves, dropDeal, groupDealsByStage } from "@/lib/deal-board";
import { DEAL_BOARD } from "@/lib/deal-board-config";
import { dealStageLabel, OPEN_STAGES } from "@/lib/deal-stage";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterInputs, RouterOutputs } from "@/lib/trpc/types";

type DealRow = RouterOutputs["deals"]["list"]["rows"][number];

type DealStage = DealRow["stage"];

type StageValues = RouterOutputs["deals"]["stageValues"];

function stageSummary(values: StageValues | undefined, stage: DealStage) {
	const entry = values?.stages.find((item) => item.stage === stage);
	if (!values || !entry) return null;
	const value = formatMoney(entry.valueCents, values.reportingCurrency);
	return entry.unconverted > 0
		? `${value} · ${entry.unconverted} not counted`
		: value;
}

export function DealsBoard({
	rows,
	total,
	input,
}: {
	rows: DealRow[];
	total: number;
	input: RouterInputs["deals"]["stageValues"];
}) {
	const trpc = useTRPC();
	const stageValues = useQuery({
		...trpc.deals.stageValues.queryOptions(input),
		placeholderData: (previous) => previous,
	});
	const openRecord = useOpenRecord();
	const prefetchRecord = usePrefetchRecord();
	const setStage = useStageMutation();
	const [moves, setMoves] = useState<ReadonlyMap<string, DealStage>>(
		() => new Map(),
	);
	const groups = groupDealsByStage(applyStageMoves(rows, moves), OPEN_STAGES);

	const move = ({ id, stage }: { id: string; stage: DealStage }) => {
		setMoves((current) => new Map(current).set(id, stage));
		setStage.mutate(
			{ id, stage },
			{
				onSettled: () =>
					setMoves((current) => {
						const next = new Map(current);
						next.delete(id);
						return next;
					}),
			},
		);
	};

	return (
		<>
			{total > rows.length ? (
				<p role="status" className="text-xs text-muted-foreground">
					Showing the first {rows.length} of {total} open deals. Narrow the
					filters to see the rest.
				</p>
			) : null}
			<Board aria-label="Deals by stage">
				{OPEN_STAGES.map((stage) => {
					const deals = groups.get(stage) ?? [];
					return (
						<BoardColumn
							key={stage}
							columnId={stage}
							title={dealStageLabel(stage)}
							count={deals.length}
							dragType={DEAL_BOARD.dragType}
							empty="Drop a deal here."
							summary={stageSummary(stageValues.data, stage)}
							onDropItem={(dealId) =>
								dropDeal({
									dealId,
									target: stage,
									rows: applyStageMoves(rows, moves),
									setStage: move,
								})
							}
						>
							{deals.map((deal) => (
								<BoardCard
									key={deal.id}
									itemId={deal.id}
									label={deal.name}
									dragType={DEAL_BOARD.dragType}
									data-stage={deal.stage}
									data-pending={moves.has(deal.id) || undefined}
									onOpen={() => openRecord({ kind: "deal", id: deal.id })}
									onHover={() => prefetchRecord({ kind: "deal", id: deal.id })}
									actions={
										<DealStageMenu
											dealId={deal.id}
											stage={deal.stage}
											variant="compact"
											label={`Change the stage of ${deal.name}`}
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
