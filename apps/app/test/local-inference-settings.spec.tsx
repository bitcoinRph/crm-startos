import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentModel } from "../app/(app)/[slug]/settings/agent-model";

const source = (path: string) =>
	readFileSync(resolve(import.meta.dir, "..", path), "utf8");

describe("inference mode settings", () => {
	it("identifies local profile limits without fake connection controls", () => {
		const html = renderToStaticMarkup(
			createElement(AgentModel, { mode: "LOCAL" }),
		);
		expect(html).toContain("Local inference");
		expect(html).toContain("fixed sales extraction workflow");
		expect(html).toContain("builder");
		expect(html).toContain("Codex");
		expect(html).toContain("OpenWebUI");
		expect(html).toContain("never fall back to a cloud model");
		expect(html).not.toMatch(/<(input|button|select|form)\b/);
	});

	it("keeps the Gateway catalog only in explicit legacy mode", () => {
		const local = renderToStaticMarkup(
			createElement(AgentModel, { mode: "LOCAL" }),
		);
		const component = source("app/(app)/[slug]/settings/agent-model.tsx");
		expect(local).not.toContain("Vercel AI Gateway");
		expect(component).toContain('mode === "LEGACY_GATEWAY"');
		expect(component).toContain("Vercel AI Gateway");
		expect(component).toContain('role="combobox"');
		const page = source("app/(app)/[slug]/settings/page.tsx");
		expect(page).toContain('mode === "LEGACY_GATEWAY"');
		expect(page).toContain("settings.modelCatalog");
	});

	it("shows disabled mode as fail closed", () => {
		const html = renderToStaticMarkup(
			createElement(AgentModel, { mode: "DISABLED" }),
		);
		expect(html).toContain("Inference is disabled");
		expect(html).not.toContain("Vercel AI Gateway");
	});

	it("opens the CRM after workspace setup instead of requesting a key", () => {
		const form = source("app/(landing)/onboarding/onboarding-form.tsx");
		expect(form).toContain('router.replace("/")');
		expect(form).not.toContain("/onboarding/research");
	});

	it("identifies company research as optional", () => {
		expect(source("app/(app)/[slug]/settings/research-key.tsx")).toContain(
			"Company research (optional)",
		);
	});
});
