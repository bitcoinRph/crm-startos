import type { DealStage } from "@crm/db/enums";
import { isClosedStage } from "./deal-stage";

type BoardDeal = { id: string; stage: DealStage };

export type StageMove = { id: string; stage: DealStage };

export function groupDealsByStage<TDeal extends BoardDeal>(
	deals: readonly TDeal[],
	stages: readonly DealStage[],
): Map<DealStage, TDeal[]> {
	const groups = new Map<DealStage, TDeal[]>(
		stages.map((stage) => [stage, []]),
	);
	for (const deal of deals) groups.get(deal.stage)?.push(deal);
	return groups;
}

export function dropDeal({
	dealId,
	target,
	rows,
	setStage,
}: {
	dealId: string;
	target: DealStage;
	rows: readonly BoardDeal[];
	setStage: (move: StageMove) => void;
}) {
	if (isClosedStage(target)) return;
	const deal = rows.find((row) => row.id === dealId);
	if (!deal || deal.stage === target) return;
	setStage({ id: dealId, stage: target });
}
