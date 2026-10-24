import { afterEach, describe, expect, it } from "bun:test";
import type { Cache } from "cache-manager";
import {
	type CatalogModel,
	ModelCatalogService,
} from "../src/settings/model-catalog.service";

const realFetch = globalThis.fetch;
const savedMode = process.env.CRM_INFERENCE_MODE;

function service() {
	const store = new Map<string, CatalogModel[]>();
	const cache = {
		get: async (key: string) => store.get(key),
		set: async (key: string, value: CatalogModel[]) => {
			store.set(key, value);
		},
	} as unknown as Cache;
	return new ModelCatalogService(cache);
}

function spyFetch() {
	const calls: string[] = [];
	globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
		calls.push(String(input));
		return Response.json({
			data: [
				{
					id: "openai/gpt-test",
					name: "GPT Test",
					owned_by: "openai",
					type: "language",
					tags: ["tool-use"],
					context_window: 128000,
					pricing: null,
				},
			],
		});
	}) as typeof fetch;
	return calls;
}

afterEach(() => {
	globalThis.fetch = realFetch;
	if (savedMode === undefined) delete process.env.CRM_INFERENCE_MODE;
	else process.env.CRM_INFERENCE_MODE = savedMode;
});

describe("the model catalog", () => {
	it("returns an empty catalog in LOCAL mode without a network call", async () => {
		process.env.CRM_INFERENCE_MODE = "LOCAL";
		const calls = spyFetch();
		expect(await service().models()).toEqual([]);
		expect(calls).toEqual([]);
	});

	it("still reads the Gateway catalog in legacy mode", async () => {
		process.env.CRM_INFERENCE_MODE = "LEGACY_GATEWAY";
		const calls = spyFetch();
		const models = await service().models();
		expect(models?.map((model) => model.id)).toEqual(["openai/gpt-test"]);
		expect(calls).toEqual(["https://ai-gateway.vercel.sh/v1/models"]);
	});
});
