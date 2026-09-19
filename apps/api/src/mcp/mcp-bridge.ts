import { API_KEY_HEADER, API_KEY_PREFIX } from "@crm/auth";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
	type CallToolRequest,
	CallToolRequestSchema,
	type CallToolResult,
	ListToolsRequestSchema,
	type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { Logger } from "@nestjs/common";
import type { AnyRouter } from "@trpc/server";
import {
	callProcedure,
	getProcedureAtPath,
	getTRPCErrorFromUnknown,
	type ProcedureType,
} from "@trpc/server/unstable-core-do-not-import";
import type { Request, Response } from "express";
import { z } from "zod";
import type { BaseTrpcContext } from "../trpc/context.types";
import { createBaseTrpcContext } from "../trpc/trpc.context";
import { MCP_TOOLS } from "./mcp-tools";

export const MCP_PATH = "/api/mcp";

const SERVER_INFO = { name: "crm", version: "1.0" };

const BEARER = /^Bearer\s+(.+)$/i;

const toolInputSchema = z.looseObject({ type: z.literal("object") });

type BoundTool = {
	tool: Tool;
	path: string;
	type: ProcedureType;
};

export type McpBridge = (req: Request, res: Response) => Promise<void>;

async function bindTools(router: AnyRouter): Promise<Map<string, BoundTool>> {
	const bound = new Map<string, BoundTool>();

	for (const spec of MCP_TOOLS) {
		const procedure = await getProcedureAtPath(router, spec.procedure);

		if (!procedure) {
			throw new Error(
				`MCP tool ${spec.name} points at ${spec.procedure}, which is not a procedure.`,
			);
		}

		const parser = procedure._def.inputs[0];
		const inputSchema =
			parser instanceof z.ZodType
				? toolInputSchema.parse(
						z.toJSONSchema(parser, { io: "input", unrepresentable: "any" }),
					)
				: { type: "object" as const, properties: {} };

		bound.set(spec.name, {
			path: spec.procedure,
			type: procedure._def.type,
			tool: {
				name: spec.name,
				description: spec.description,
				inputSchema,
				annotations: { readOnlyHint: procedure._def.type === "query" },
			},
		});
	}

	return bound;
}

function failure(text: string): CallToolResult {
	return { isError: true, content: [{ type: "text", text }] };
}

async function callTool(
	router: AnyRouter,
	ctx: BaseTrpcContext,
	bound: Map<string, BoundTool>,
	params: CallToolRequest["params"],
	logger: Logger,
): Promise<CallToolResult> {
	const target = bound.get(params.name);

	if (!target) return failure(`Unknown tool: ${params.name}`);

	try {
		const result = await callProcedure({
			router,
			ctx,
			path: target.path,
			type: target.type,
			getRawInput: async () => params.arguments ?? {},
			signal: undefined,
			batchIndex: 0,
		});

		return { content: [{ type: "text", text: JSON.stringify(result) }] };
	} catch (error) {
		const trpcError = getTRPCErrorFromUnknown(error);

		if (trpcError.code === "INTERNAL_SERVER_ERROR") {
			logger.error(
				{ message: "MCP tool failed", tool: params.name },
				trpcError.stack,
			);
			return failure(`${params.name} failed. The API log has the detail.`);
		}

		return failure(`${trpcError.code}: ${trpcError.message}`);
	}
}

function acceptBearerApiKey(req: Request): void {
	if (req.headers[API_KEY_HEADER]) return;

	const token = BEARER.exec(req.headers.authorization ?? "")?.[1]?.trim();

	if (token?.startsWith(API_KEY_PREFIX)) {
		req.headers[API_KEY_HEADER] = token;
	}
}

export function createMcpBridge(router: AnyRouter): McpBridge {
	const logger = new Logger("McpBridge");
	const bound = bindTools(router);

	return async (req, res) => {
		acceptBearerApiKey(req);

		const ctx = await createBaseTrpcContext(req);

		if (!ctx.session) {
			res.status(401).json({
				error: `Send a CRM API key in the ${API_KEY_HEADER} header or as a Bearer token.`,
			});
			return;
		}

		const tools = await bound;
		const server = new Server(SERVER_INFO, { capabilities: { tools: {} } });

		server.setRequestHandler(ListToolsRequestSchema, async () => ({
			tools: [...tools.values()].map((entry) => entry.tool),
		}));

		server.setRequestHandler(CallToolRequestSchema, (request) =>
			callTool(router, ctx, tools, request.params, logger),
		);

		const transport = new StreamableHTTPServerTransport({
			sessionIdGenerator: undefined,
			enableJsonResponse: true,
		});

		res.on("close", () => {
			void transport.close();
			void server.close();
		});

		try {
			await server.connect(transport);
			await transport.handleRequest(req, res);
		} catch (error) {
			logger.error(
				{ message: "MCP request failed" },
				error instanceof Error ? error.stack : String(error),
			);

			if (!res.headersSent) {
				res.status(500).json({ error: "The MCP request failed." });
			}
		}
	};
}
