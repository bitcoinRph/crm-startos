const LINE_END = "\r\n";
const NEEDS_QUOTES = /[",\r\n]/;
const FORMULA_LEAD = /^[=+\-@\t\r]/;

export type CsvRow = Record<string, string>;

export function protectCell(value: string): string {
	return FORMULA_LEAD.test(value) ? `'${value}` : value;
}

function writeCell(value: string): string {
	const safe = protectCell(value);
	return NEEDS_QUOTES.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function writeCsv(
	columns: readonly string[],
	rows: readonly CsvRow[],
): string {
	const header = columns.map((column) => writeCell(column)).join(",");
	const body = rows.map((row) =>
		columns.map((column) => writeCell(row[column] ?? "")).join(","),
	);
	return [header, ...body].map((line) => line + LINE_END).join("");
}
