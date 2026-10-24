"use client";

import { cn } from "@crm/ui/lib/utils";
import * as React from "react";

function Board({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="board"
			className={cn(
				"grid min-h-0 flex-1 auto-cols-[minmax(16rem,1fr)] grid-flow-col gap-3 overflow-auto",
				className,
			)}
			{...props}
		/>
	);
}

function BoardColumn({
	columnId,
	title,
	count,
	dragType,
	onDropItem,
	className,
	children,
	...props
}: Omit<React.ComponentProps<"section">, "title" | "onDrop"> & {
	columnId: string;
	title: React.ReactNode;
	count: number;
	dragType: string;
	onDropItem: (itemId: string) => void;
}) {
	const [over, setOver] = React.useState(false);

	return (
		<section
			data-slot="board-column"
			data-board-column={columnId}
			data-over={over || undefined}
			className={cn(
				"flex min-h-0 flex-col gap-2 rounded-lg border bg-muted/40 p-2 data-over:bg-muted",
				className,
			)}
			onDragOver={(event) => {
				if (!event.dataTransfer.types.includes(dragType)) return;
				event.preventDefault();
				event.dataTransfer.dropEffect = "move";
				setOver(true);
			}}
			onDragLeave={(event) => {
				if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
					return;
				}
				setOver(false);
			}}
			onDrop={(event) => {
				setOver(false);
				const itemId = event.dataTransfer.getData(dragType);
				if (!itemId) return;
				event.preventDefault();
				onDropItem(itemId);
			}}
			{...props}
		>
			<header className="flex items-center justify-between gap-2 px-1 text-xs font-medium">
				<span className="truncate">{title}</span>
				<span className="text-muted-foreground tabular-nums">{count}</span>
			</header>
			<div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
				{children}
			</div>
		</section>
	);
}

function BoardCard({
	itemId,
	dragType,
	onOpen,
	onHover,
	actions,
	className,
	children,
	...props
}: Omit<React.ComponentProps<"div">, "onDragStart" | "draggable"> & {
	itemId: string;
	dragType: string;
	onOpen: () => void;
	onHover?: () => void;
	actions?: React.ReactNode;
}) {
	const [dragging, setDragging] = React.useState(false);

	return (
		<div
			data-slot="board-card"
			data-dragging={dragging || undefined}
			draggable
			className={cn(
				"flex cursor-grab flex-col gap-2 rounded-lg border bg-card p-3 active:cursor-grabbing data-dragging:opacity-50",
				className,
			)}
			onDragStart={(event) => {
				event.dataTransfer.setData(dragType, itemId);
				event.dataTransfer.effectAllowed = "move";
				setDragging(true);
			}}
			onDragEnd={() => setDragging(false)}
			{...props}
		>
			<button
				type="button"
				className="flex min-w-0 flex-col items-start gap-1 text-left"
				onClick={onOpen}
				onMouseEnter={onHover}
			>
				{children}
			</button>
			{actions}
		</div>
	);
}

export { Board, BoardCard, BoardColumn };
