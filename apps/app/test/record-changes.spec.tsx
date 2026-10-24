import { describe, expect, it } from "bun:test";
import { useQueryClient } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { RecordChanges } from "../components/crm/record-changes";
import { RECORD_CHANGES } from "../components/crm/record-changes-config";
import { TRPCReactProvider, useTRPC } from "../lib/trpc/client";
import type { RouterOutputs } from "../lib/trpc/types";

type Change = RouterOutputs["recordChanges"]["list"][number];

const base: Change = {
	id: "00000000-0000-4000-8000-000000000001",
	entity: "CONTACT",
	recordId: "contact-1",
	fieldId: null,
	fieldLabel: null,
	operation: "UPDATE",
	before: { title: "Buyer" },
	after: { title: "Head of Buying" },
	valuesHidden: false,
	actorKind: "USER",
	actorId: null,
	actorUserId: "user-1",
	revertible: true,
	createdAt: "2026-09-22T00:00:00.000Z",
};

const hiddenValues: Change = {
	...base,
	id: "00000000-0000-4000-8000-000000000005",
	actorKind: "API_KEY",
	before: null,
	after: null,
	valuesHidden: true,
	revertible: true,
};

const changes: Change[] = [
	base,
	{
		...base,
		id: "00000000-0000-4000-8000-000000000002",
		actorKind: "API_KEY",
		before: { archivedAt: null },
		after: { archivedAt: "2026-09-22T10:15:00.000" },
		revertible: false,
	},
	{
		...base,
		id: "00000000-0000-4000-8000-000000000003",
		actorKind: "AGENT",
		fieldId: "field-1",
		fieldLabel: "Favourite colour",
		before: { text: "red" },
		after: { text: "green" },
		revertible: false,
	},
	{
		...base,
		id: "00000000-0000-4000-8000-000000000004",
		actorKind: "SYSTEM",
		operation: "CREATE",
		before: null,
		after: null,
		revertible: true,
	},
	hiddenValues,
];

function Seed({
	input,
	rows,
	filter,
}: {
	input: Parameters<
		ReturnType<typeof useTRPC>["recordChanges"]["list"]["queryKey"]
	>[0];
	rows: Change[];
	filter: Parameters<typeof RecordChanges>[0]["filter"];
}) {
	const trpc = useTRPC();
	const client = useQueryClient();
	client.setQueryData(trpc.recordChanges.list.queryKey(input), rows);
	return <RecordChanges filter={filter} />;
}

function render(
	filter: Parameters<typeof RecordChanges>[0]["filter"],
	rows: Change[],
) {
	const limit = RECORD_CHANGES.list.limit;
	const input =
		"apiKeyId" in filter
			? { apiKeyId: filter.apiKeyId, limit }
			: { entity: filter.entity, recordId: filter.recordId, limit };
	return renderToStaticMarkup(
		<TRPCReactProvider>
			<Seed input={input} rows={rows} filter={filter} />
		</TRPCReactProvider>,
	);
}

describe("record changes list", () => {
	const html = render({ entity: "CONTACT", recordId: "contact-1" }, changes);

	it("names who made each change", () => {
		for (const actor of ["Person", "API key", "CRM agent", "System"]) {
			expect(html).toContain(actor);
		}
	});

	it("shows each change as before to after", () => {
		expect(html).toContain("Title: Buyer → Head of Buying");
		expect(html).toContain("Archived at: empty → ");
		expect(html).toContain('dateTime="2026-09-22T10:15:00.000Z"');
		expect(html).not.toContain("2026-09-22T10:15:00.000<");
		expect(html).toContain("Created");
	});

	it("uses the label of a custom field", () => {
		expect(html).toContain("Favourite colour: red → green");
		expect(html).not.toContain("Text: red");
	});

	it("offers Undo only on revertible rows", () => {
		expect(html.match(/>Undo</g)).toHaveLength(3);
		expect(html).toContain('aria-label="Undo change to Title"');
	});

	it("says that undoing a creation archives the record", () => {
		expect(html).toContain('aria-label="Undo creation: archive this contact"');
	});

	it("offers Forget on every row", () => {
		expect(html.match(/>Forget</g)).toHaveLength(changes.length);
		expect(html).toContain('aria-label="Forget change to Title"');
		expect(html).toContain('aria-label="Forget creation of contact"');
	});

	it("hides values when the server withholds them", () => {
		const hidden = render({ entity: "CONTACT", recordId: "contact-1" }, [
			hiddenValues,
		]);
		expect(hidden).toContain("Values hidden");
		expect(hidden).not.toContain("→");
	});

	it("shows the record kind in the API key view", () => {
		expect(html).not.toContain("· Contact");
		const byKey = render({ apiKeyId: "key-1" }, changes);
		expect(byKey).toContain("Contact");
		expect(byKey).toContain(">Undo<");
	});

	it("says when nothing was recorded", () => {
		expect(render({ apiKeyId: "key-1" }, [])).toContain(
			"No recorded changes yet.",
		);
	});
});
