import { describe, expect, it } from "bun:test";
import {
	CsvParseError,
	parseCsv,
	unprotectCell,
	writeCsv,
} from "../src/crm/csv";

describe("writeCsv", () => {
	it("joins cells with commas and rows with CRLF", () => {
		expect(writeCsv(["a", "b"], [{ a: "1", b: "2" }])).toBe("a,b\r\n1,2\r\n");
	});

	it("writes only the header for no rows", () => {
		expect(writeCsv(["a", "b"], [])).toBe("a,b\r\n");
	});

	it("quotes cells with a comma, a quote, CR or LF", () => {
		const csv = writeCsv(
			["a"],
			[{ a: "x,y" }, { a: 'say "hi"' }, { a: "one\ntwo" }, { a: "one\rtwo" }],
		);
		expect(csv).toBe(
			'a\r\n"x,y"\r\n"say ""hi"""\r\n"one\ntwo"\r\n"one\rtwo"\r\n',
		);
	});

	it("leaves plain cells unquoted", () => {
		expect(writeCsv(["a"], [{ a: "plain text" }])).toBe("a\r\nplain text\r\n");
	});

	it("writes a missing cell as empty", () => {
		expect(writeCsv(["a", "b"], [{ a: "1" }])).toBe("a,b\r\n1,\r\n");
	});

	it("keeps the column order of the header", () => {
		expect(writeCsv(["b", "a"], [{ a: "1", b: "2" }])).toBe("b,a\r\n2,1\r\n");
	});

	it("prefixes a single quote to cells a spreadsheet would run as a formula", () => {
		for (const lead of ["=", "+", "-", "@", "\t"]) {
			const csv = writeCsv(["a"], [{ a: `${lead}SUM(A1)` }]);
			expect(csv).toBe(`a\r\n'${lead}SUM(A1)\r\n`);
		}
	});

	it("prefixes and quotes a formula cell that also needs quoting", () => {
		expect(writeCsv(["a"], [{ a: '=HYPERLINK("x","y")' }])).toBe(
			'a\r\n"\'=HYPERLINK(""x"",""y"")"\r\n',
		);
	});

	it("does not prefix a formula character that is not first", () => {
		expect(writeCsv(["a"], [{ a: "a=b" }])).toBe("a\r\na=b\r\n");
	});
});

describe("parseCsv", () => {
	it("splits cells and records", () => {
		expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
			["a", "b"],
			["1", "2"],
		]);
	});

	it("reads LF and bare CR line endings", () => {
		expect(parseCsv("a,b\n1,2\n")).toEqual([
			["a", "b"],
			["1", "2"],
		]);
		expect(parseCsv("a,b\r1,2\r")).toEqual([
			["a", "b"],
			["1", "2"],
		]);
	});

	it("reads a last record that has no line ending", () => {
		expect(parseCsv("a,b\n1,2")).toEqual([
			["a", "b"],
			["1", "2"],
		]);
	});

	it("drops a leading byte order mark", () => {
		expect(parseCsv("\uFEFFname,email\nAda,ada@x.test")).toEqual([
			["name", "email"],
			["Ada", "ada@x.test"],
		]);
	});

	it("reads quoted commas, doubled quotes and embedded line breaks", () => {
		expect(
			parseCsv('a,b\r\n"x,y","say ""hi"""\r\n"one\r\ntwo","three\nfour"\r\n'),
		).toEqual([
			["a", "b"],
			["x,y", 'say "hi"'],
			["one\r\ntwo", "three\nfour"],
		]);
	});

	it("keeps empty cells, including trailing ones", () => {
		expect(parseCsv("a,b,c\n1,,\n,,\n,2,")).toEqual([
			["a", "b", "c"],
			["1", "", ""],
			["", "2", ""],
		]);
	});

	it("reads an explicitly empty quoted cell as empty", () => {
		expect(parseCsv('a,b\n"",x')).toEqual([
			["a", "b"],
			["", "x"],
		]);
	});

	it("skips records that hold only empty cells", () => {
		expect(parseCsv("a,b\n\n1,2\n\n\n")).toEqual([
			["a", "b"],
			["1", "2"],
		]);
	});

	it("returns nothing for empty text", () => {
		expect(parseCsv("")).toEqual([]);
		expect(parseCsv("\uFEFF")).toEqual([]);
	});

	it("names the line of a quote that never closes", () => {
		const error = (() => {
			try {
				parseCsv('a,b\n1,2\n3,"never closed\n4,5');
			} catch (caught) {
				return caught;
			}
			return null;
		})();
		expect(error).toBeInstanceOf(CsvParseError);
		expect(error).toMatchObject({ line: 3 });
	});

	it("rejects a quote inside an unquoted cell and text after a closing quote", () => {
		expect(() => parseCsv('a\nx"y')).toThrow(CsvParseError);
		expect(() => parseCsv('a\n"x"y')).toThrow(CsvParseError);
	});

	it("reads back what writeCsv wrote", () => {
		const rows = [
			{ a: "plain", b: "x,y", c: 'q"q' },
			{ a: "line\r\nbreak", b: "", c: "end" },
			{ a: "\u00e9\u00e8 \u65e5\u672c", b: "tab\there", c: " padded " },
		];
		const parsed = parseCsv(writeCsv(["a", "b", "c"], rows));
		expect(parsed.slice(1)).toEqual(rows.map((row) => [row.a, row.b, row.c]));
	});
});

describe("unprotectCell", () => {
	it("undoes the leading quote that writeCsv adds", () => {
		for (const value of ["=SUM(A1)", "+1 555 0100", "-5", "@handle", "\tx"]) {
			const written = writeCsv(["a"], [{ a: value }]);
			const cell = parseCsv(written)[1]?.[0] ?? "";
			expect(unprotectCell(cell)).toBe(value);
		}
	});

	it("leaves other quoted text alone", () => {
		expect(unprotectCell("'hello")).toBe("'hello");
		expect(unprotectCell("it's")).toBe("it's");
		expect(unprotectCell("plain")).toBe("plain");
	});
});
