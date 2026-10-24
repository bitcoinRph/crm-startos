"use client";

import { Combobox, type ComboboxOption } from "@crm/ui/components/combobox";
import { useSearchInput } from "@crm/ui/hooks/use-search-input";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTRPC } from "@/lib/trpc/client";

const MIN_QUERY_LENGTH = 2;

export function ContactPicker({
	id,
	value,
	onValueChange,
	selected,
	placeholder = "Choose a contact",
	disabled,
}: {
	id?: string;
	value: string;
	onValueChange: (value: string) => void;
	selected?: ComboboxOption;
	placeholder?: string;
	disabled?: boolean;
}) {
	const trpc = useTRPC();

	const [query, setQuery] = useState("");
	const [text, setText] = useSearchInput(query, setQuery);
	const [chosen, setChosen] = useState<ComboboxOption | null>(null);
	const searching = query.trim().length >= MIN_QUERY_LENGTH;

	const search = useQuery({
		...trpc.search.quick.queryOptions({ q: query }),
		enabled: searching,
		placeholderData: (previous) => previous,
	});

	const options: ComboboxOption[] = searching
		? (search.data?.hits ?? []).flatMap((hit) =>
				hit.kind === "contact"
					? [
							{
								value: hit.id,
								label: hit.label,
								hint: hit.detail ?? undefined,
							},
						]
					: [],
			)
		: [];

	const current =
		chosen?.value === value
			? chosen
			: (options.find((option) => option.value === value) ??
				(selected?.value === value ? selected : undefined));

	return (
		<Combobox
			id={id}
			value={value}
			onValueChange={(next) => {
				setChosen(options.find((option) => option.value === next) ?? null);
				onValueChange(next);
			}}
			options={options}
			selectedOption={current}
			disabled={disabled}
			placeholder={placeholder}
			searchPlaceholder="Search contacts by name or email…"
			empty={
				!searching
					? "Type two or more letters."
					: search.isFetching
						? "Searching…"
						: "No contact matches."
			}
			search={text}
			onSearchChange={setText}
			stale={search.isFetching || text.trim() !== query.trim()}
		/>
	);
}
