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
	empty,
	summary,
	className,
	children,
	...props
}: Omit<React.ComponentProps<"section">, "title" | "onDrop"> & {
	columnId: string;
	title: React.ReactNode;
	count: number;
	dragType: string;
	onDropItem: (itemId: string) => void;
	empty?: React.ReactNode;
	summary?: React.ReactNode;
}) {
	const [over, setOver] = React.useState(false);
	const titleId = React.useId();

	return (
		<section
			data-slot="board-column"
			data-board-column={columnId}
			data-count={count}
			data-over={over || undefined}
			aria-labelledby={titleId}
			className={cn(
				"flex min-h-0 flex-col gap-2 rounded-lg border bg-muted/40 p-2 transition-colors data-over:bg-muted data-over:ring-2 data-over:ring-ring/40",
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
			<header className="flex flex-col gap-0.5 px-1 py-0.5 text-xs">
				<div className="flex items-center justify-between gap-2 font-medium">
					<h2 id={titleId} className="truncate">
						{title}
					</h2>
					<span className="text-muted-foreground tabular-nums">{count}</span>
				</div>
				{summary ? (
					<div
						data-slot="board-column-summary"
						className="truncate text-muted-foreground tabular-nums"
					>
						{summary}
					</div>
				) : null}
			</header>
			<ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
				{count === 0 && empty ? (
					<li
						data-slot="board-column-empty"
						className="rounded-lg border border-dashed px-3 py-6 text-center text-muted-foreground text-xs"
					>
						{empty}
					</li>
				) : (
					children
				)}
			</ul>
		</section>
	);
}

function BoardCard({
	itemId,
	dragType,
	onOpen,
	onHover,
	label,
	actions,
	className,
	children,
	...props
}: Omit<React.ComponentProps<"li">, "onDragStart" | "draggable"> & {
	itemId: string;
	dragType: string;
	onOpen: () => void;
	onHover?: () => void;
	label: string;
	actions?: React.ReactNode;
}) {
	const [dragging, setDragging] = React.useState(false);

	return (
		<li
			data-slot="board-card"
			data-board-item={itemId}
			data-dragging={dragging || undefined}
			draggable
			className={cn(
				"flex cursor-grab items-start gap-2 rounded-lg border bg-card p-3 text-xs/relaxed transition-[opacity,box-shadow] hover:ring-1 hover:ring-foreground/10 active:cursor-grabbing has-focus-visible:ring-2 has-focus-visible:ring-ring/50 data-dragging:opacity-50",
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
				aria-label={`Open ${label}`}
				className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left outline-none"
				onClick={onOpen}
				onMouseEnter={onHover}
				onFocus={onHover}
			>
				{children}
			</button>
			{actions}
		</li>
	);
}

export { Board, BoardCard, BoardColumn };
