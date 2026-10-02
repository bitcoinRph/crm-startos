import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { CodexStatus } from "@crm/validation/codex";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { KEY_PERMISSIONS } from "../src/api-keys/api-key-profiles";
import * as contracts from "../src/codex/codex.contracts";
import { CodexService } from "../src/codex/codex.service";
import { authorizeApiKeyProcedure } from "../src/trpc/api-key-access";

const SECRET_NAMES =
	/(token|secret|password|sealed|verifier|apikey|api_key|key)$/i;

type SchemaNode = {
	properties?: Record<string, SchemaNode>;
	items?: SchemaNode | SchemaNode[];
	anyOf?: SchemaNode[];
	oneOf?: SchemaNode[];
	allOf?: SchemaNode[];
};

const schemaNode: z.ZodType<SchemaNode> = z.lazy(() =>
	z.looseObject({
		properties: z.record(z.string(), schemaNode).optional(),
		items: z.union([schemaNode, z.array(schemaNode)]).optional(),
		anyOf: z.array(schemaNode).optional(),
		oneOf: z.array(schemaNode).optional(),
		allOf: z.array(schemaNode).optional(),
	}),
);

function propertyNames(node: SchemaNode): string[] {
	const children = [
		...Object.values(node.properties ?? {}),
		...[node.items ?? []].flat(),
		...(node.anyOf ?? []),
		...(node.oneOf ?? []),
		...(node.allOf ?? []),
	];
	return [
		...Object.keys(node.properties ?? {}),
		...children.flatMap(propertyNames),
	];
}

const outputs = Object.entries(contracts).filter(([name]) =>
	name.endsWith("Output"),
);

const status = {
	available: true,
	connected: true,
	kind: "CHATGPT",
	state: "ACTIVE",
	label: "rep@example.com",
	planType: "plus",
	modelId: null,
	modelContextWindowTokens: null,
	connectedAt: "2026-10-02T00:00:00.000Z",
	lastError: null,
} satisfies CodexStatus;

type Sent = { url: string; authorization: string | null; body: unknown };

const realFetch = globalThis.fetch;
const savedSecret = process.env.AGENT_BRIDGE_SECRET;
let sent: Sent[] = [];
let answer: () => Response = () => Response.json(status);

beforeEach(() => {
	sent = [];
	answer = () => Response.json(status);
	process.env.AGENT_BRIDGE_SECRET = "bridge-secret";
	globalThis.fetch = (async (
		input: Parameters<typeof fetch>[0],
		init?: RequestInit,
	) => {
		sent.push({
			url: String(input),
			authorization: new Headers(init?.headers).get("authorization"),
			body: JSON.parse(String(init?.body)),
		});
		return answer();
	}) as typeof fetch;
});

afterEach(() => {
	globalThis.fetch = realFetch;
	if (savedSecret === undefined) delete process.env.AGENT_BRIDGE_SECRET;
	else process.env.AGENT_BRIDGE_SECRET = savedSecret;
});

describe("Codex output contracts", () => {
	it("cover every Codex output", () => {
		expect(outputs.map(([name]) => name).sort()).toEqual([
			"codexModelsOutput",
			"codexPollOutput",
			"codexSignInOutput",
			"codexStatusOutput",
		]);
	});

	for (const [name, schema] of outputs)
		it(`${name} has no field that could carry a credential`, () => {
			const names = propertyNames(
				schemaNode.parse(z.toJSONSchema(z.object({ value: schema }))),
			);
			expect(names.length).toBeGreaterThan(0);
			expect(names.filter((key) => SECRET_NAMES.test(key))).toEqual([]);
		});

	it("the pattern catches the credential names the agent stores", () => {
		for (const key of [
			"accessToken",
			"refreshToken",
			"idToken",
			"apiKey",
			"sealed",
			"code_verifier",
			"secret",
		])
			expect(SECRET_NAMES.test(key)).toBe(true);
		expect(SECRET_NAMES.test("contextWindowTokens")).toBe(false);
	});

	it("rejects an agent answer that carries extra fields", () => {
		expect(
			contracts.codexStatusOutput.safeParse({
				...status,
				accessToken: "eyJ.leak",
			}).success,
		).toBe(false);
	});
});

describe("API keys and Codex", () => {
	it("denies every codex procedure to every key profile", () => {
		for (const permissions of [null, ...Object.values(KEY_PERMISSIONS)])
			for (const { path, type } of [
				{ path: "codex.status", type: "query" },
				{ path: "codex.startSignIn", type: "mutation" },
				{ path: "codex.connectApiKey", type: "mutation" },
				{ path: "codex.disconnect", type: "mutation" },
			])
				expect(
					authorizeApiKeyProcedure(
						{ referenceId: "u", permissions },
						path,
						type,
					),
				).toBe("deny");
	});
});

describe("CodexService", () => {
	it("asks the agent for the signed-in user only, with the bridge secret", async () => {
		const service = new CodexService();
		expect(await service.status("user-1")).toEqual(status);
		expect(sent).toEqual([
			{
				url: "http://127.0.0.1:2000/internal/crm/codex/status",
				authorization: "Bearer bridge-secret",
				body: { userId: "user-1" },
			},
		]);
	});

	it("refuses to pass on an answer that leaks a credential", async () => {
		answer = () => Response.json({ ...status, refreshToken: "r-1" });
		await expect(new CodexService().status("user-1")).rejects.toThrow();
	});

	it("turns an agent refusal into a readable BAD_REQUEST", async () => {
		answer = () =>
			Response.json(
				{ error: "OpenAI did not accept that API key." },
				{ status: 422 },
			);
		let failure: TRPCError | null = null;
		try {
			await new CodexService().connectApiKey(
				"user-1",
				"sk-test-0123456789abcdef",
			);
		} catch (error) {
			if (error instanceof TRPCError) failure = error;
		}
		expect(failure?.code).toBe("BAD_REQUEST");
		expect(failure?.message).toBe("OpenAI did not accept that API key.");
	});

	it("reports Codex as unavailable without a bridge, and asks nothing", async () => {
		delete process.env.AGENT_BRIDGE_SECRET;
		expect((await new CodexService().status("user-1")).available).toBe(false);
		expect(sent).toEqual([]);
	});
});
