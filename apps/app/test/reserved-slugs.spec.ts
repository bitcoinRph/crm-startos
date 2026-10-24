import { describe, expect, it } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { RESERVED_SLUGS } from "@crm/db/workspace";

const APP_DIR = join(import.meta.dir, "../app");

function topLevelRoutes(): string[] {
	const entries = readdirSync(APP_DIR, { withFileTypes: true });
	const routes: string[] = [];
	for (const entry of entries) {
		if (entry.isDirectory() && entry.name.startsWith("(")) {
			for (const child of readdirSync(join(APP_DIR, entry.name), {
				withFileTypes: true,
			})) {
				if (child.isDirectory()) routes.push(child.name);
			}
		} else if (entry.isDirectory()) {
			routes.push(entry.name);
		} else if (/^(icon|apple-icon)\.tsx$/.test(entry.name)) {
			routes.push(entry.name.replace(/\.tsx$/, ""));
		}
	}
	return routes.filter(
		(route) => !route.startsWith("[") && !route.includes("."),
	);
}

describe("reserved workspace slugs", () => {
	it("reserve every top-level route the app serves", () => {
		const routes = topLevelRoutes();
		expect(routes).toContain("rest");
		for (const route of routes) expect(RESERVED_SLUGS).toContain(route);
	});
});
