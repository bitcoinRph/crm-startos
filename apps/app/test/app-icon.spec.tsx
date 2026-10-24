import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Logo, { LOGO_SLAB } from "@crm/ui/components/logo";
import { Spinner } from "@crm/ui/components/spinner";
import { renderToStaticMarkup } from "react-dom/server";
import { z } from "zod";

const STARTOS_ICON = readFileSync(
	join(import.meta.dir, "../../../deploy/startos/icon.svg"),
	"utf8",
);

const numbers = z.array(z.coerce.number()).length(6);

function attribute(source: string, pattern: RegExp): string {
	const match = source.match(pattern);
	if (!match?.[1]) throw new Error(`No match for ${pattern}`);
	return match[1];
}

function cellPath(
	matrix: number[],
	x: number,
	y: number,
	side: number,
): string {
	const [a, b, c, d, e, f] = matrix as [
		number,
		number,
		number,
		number,
		number,
		number,
	];
	const point = (u: number, v: number) => {
		const px = Number((a * u + c * v + e).toFixed(4));
		const py = Number((b * u + d * v + f).toFixed(4));
		return `${px} ${py}`;
	};
	return `M${point(x, y)}L${point(x + side, y)}L${point(x + side, y + side)}L${point(x, y + side)}Z`;
}

describe("app icon", () => {
	const matrix = numbers.parse(
		attribute(
			STARTOS_ICON,
			/id="top-plane" transform="matrix\(([^)]+)\)"/,
		).split(","),
	);
	const side = Number(attribute(STARTOS_ICON, /id="cell" width="([^"]+)"/));
	const cells = [
		...STARTOS_ICON.matchAll(
			/<use id="([^"]+)" href="#cell" x="([^"]+)" y="([^"]+)" fill="([^"]+)"/g,
		),
	].map(([, id, x, y, fill]) => ({
		id,
		fill,
		path: cellPath(matrix, Number(x), Number(y), side),
	}));
	const markup = renderToStaticMarkup(<Logo />);

	it("draws the StartOS package slab", () => {
		expect(attribute(STARTOS_ICON, /id="slab"[^>]* d="([^"]+)"/)).toBe(
			LOGO_SLAB,
		);
		expect(markup).toContain(LOGO_SLAB);
	});

	it("draws every StartOS cell at its StartOS position", () => {
		expect(cells).toHaveLength(4);
		for (const cell of cells) expect(markup).toContain(cell.path);
	});

	it("fills the accent cell with the StartOS colour", () => {
		const accent = cells.find((cell) => cell.fill !== "#FFFFFF");
		expect(accent?.fill).toBe("#A03E0F");
		expect(markup).toContain(`d="${accent?.path}" fill="#A03E0F"`);
	});

	it("draws the same mark inside the loading spinner", () => {
		const spinner = renderToStaticMarkup(<Spinner />);
		expect(spinner).toContain(LOGO_SLAB);
		for (const cell of cells) expect(spinner).toContain(cell.path);
		expect(spinner).toContain("motion-reduce:animate-none");
	});
});
