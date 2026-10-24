const LINE_END = "\r\n";
const NEEDS_QUOTES = /[",\r\n]/;
const FORMULA_LEAD = /^[=+\-@\t\r]/;

export type CsvRow = Record<string, string>;

function protectCell(value: string): string {
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

const BYTE_ORDER_MARK = "﻿";
const PROTECTED_CELL = /^'([=+\-@\t\r])/;

export class CsvParseError extends Error {
	constructor(
		message: string,
		readonly line: number,
	) {
		super(message);
		this.name = "CsvParseError";
	}
}

export function unprotectCell(value: string): string {
	return value.replace(PROTECTED_CELL, "$1");
}

export function parseCsv(input: string): string[][] {
	const text = input.startsWith(BYTE_ORDER_MARK) ? input.slice(1) : input;
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let line = 1;
	let quoteLine = 1;
	let inQuotes = false;
	let closedQuote = false;
	let cellStarted = false;

	const endCell = () => {
		row.push(cell);
		cell = "";
		closedQuote = false;
		cellStarted = false;
	};

	const endRow = () => {
		endCell();
		if (row.some((entry) => entry !== "")) rows.push(row);
		row = [];
	};

	for (let index = 0; index < text.length; index += 1) {
		const char = text.charAt(index);

		if (inQuotes) {
			if (char !== '"') {
				if (char === "\n") line += 1;
				cell += char;
			} else if (text.charAt(index + 1) === '"') {
				cell += '"';
				index += 1;
			} else {
				inQuotes = false;
				closedQuote = true;
			}
			continue;
		}

		if (char === ",") {
			endCell();
		} else if (char === "\n" || char === "\r") {
			if (char === "\r" && text.charAt(index + 1) === "\n") index += 1;
			endRow();
			line += 1;
		} else if (closedQuote) {
			throw new CsvParseError(
				`Line ${line}: text follows a closing quote.`,
				line,
			);
		} else if (char === '"') {
			if (cellStarted) {
				throw new CsvParseError(
					`Line ${line}: a quote inside a cell that is not quoted.`,
					line,
				);
			}
			inQuotes = true;
			cellStarted = true;
			quoteLine = line;
		} else {
			cell += char;
			cellStarted = true;
		}
	}

	if (inQuotes) {
		throw new CsvParseError(
			`Line ${quoteLine}: a quoted cell is never closed.`,
			quoteLine,
		);
	}
	if (cellStarted || cell !== "" || row.length > 0 || closedQuote) endRow();

	return rows;
}
