import { finished } from "node:stream/promises";
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
import { type AnyRouter, TRPCError } from "@trpc/server";
import {
	callProcedure,
	getProcedureAtPath,
	getTRPCErrorFromUnknown,
	type ProcedureType,
} from "@trpc/server/unstable-core-do-not-import";
import type { Request, Response } from "express";
import { z } from "zod";
import { SALES_MCP_SCOPES, salesKeyAllows } from "../sales/sales.auth";
import { authorizeApiKeyProcedure } from "../trpc/api-key-access";
import type { BaseTrpcContext } from "../trpc/context.types";
import { verifiedApiKey } from "../trpc/middlewares/auth.middleware";
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

async function refuse(
	req: Request,
	res: Response,
	status: number,
	error: string,
): Promise<void> {
	try {
		const drained = finished(req, { cleanup: true });
		req.resume();
		await drained;
	} catch {
		res.destroy();
		return;
	}
	res.status(status).json({ error });
}

export function createMcpBridge(router: AnyRouter): McpBridge {
	const logger = new Logger("McpBridge");
	const bound = bindTools(router);

	return async (req, res) => {
		if (req.method !== "POST") {
			res
				.status(405)
				.set("Allow", "POST")
				.json({
					jsonrpc: "2.0",
					error: { code: -32000, message: "Method not allowed." },
					id: null,
				});
			return;
		}

		acceptBearerApiKey(req);

		let ctx: BaseTrpcContext;
		try {
			ctx = await createBaseTrpcContext(req);
		} catch (error) {
			if (error instanceof TRPCError && error.code === "TOO_MANY_REQUESTS") {
				await refuse(req, res, 429, error.message);
				return;
			}
			throw error;
		}

		if (!ctx.session) {
			await refuse(
				req,
				res,
				401,
				`Send a CRM API key in the ${API_KEY_HEADER} header or as a Bearer token.`,
			);
			return;
		}

		const tools = await bound;
		const server = new Server(SERVER_INFO, { capabilities: { tools: {} } });

		const userId = ctx.session.user.id;
		server.setRequestHandler(ListToolsRequestSchema, async () => {
			const key = await verifiedApiKey(ctx, userId);
			const visible = [...tools.values()].filter((entry) => {
				if (!key) return true;
				const decision = authorizeApiKeyProcedure(key, entry.path, entry.type);
				if (decision !== "sales") return decision !== "deny";
				const scopes = SALES_MCP_SCOPES.get(entry.path);
				return (
					scopes?.every((scope) => salesKeyAllows(key.permissions, scope)) ??
					false
				);
			});
			return { tools: visible.map((entry) => entry.tool) };
		});

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
