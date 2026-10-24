import { describe, expect, it } from "bun:test";
import { writeCsv } from "../src/crm/csv";

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
