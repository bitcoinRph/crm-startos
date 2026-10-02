import {
	type CodexStatus,
	codexBridgeApiKey,
	codexBridgeModel,
	codexBridgeUser,
} from "@crm/validation/codex";
import { listCodexModels } from "./catalog";
import {
	CodexUnavailableError,
	chooseCodexModel,
	codexStatus,
	connectApiKey,
	disconnectCodex,
	pollDeviceLogin,
	startDeviceLogin,
} from "./connection";
import { CodexAuthError, type CodexFetch } from "./oauth";

async function body(request: Request): Promise<unknown> {
	return request.json().catch(() => null);
}

async function refusing(work: () => Promise<Response>): Promise<Response> {
	try {
		return await work();
	} catch (error) {
		if (
			error instanceof CodexUnavailableError ||
			error instanceof CodexAuthError
		)
			return Response.json({ error: error.message }, { status: 422 });
		throw error;
	}
}

function malformed(): Response {
	return Response.json({ error: "The request is malformed." }, { status: 400 });
}

export async function statusRoute(request: Request): Promise<Response> {
	const parsed = codexBridgeUser.safeParse(await body(request));
	if (!parsed.success) return malformed();
	return Response.json(await codexStatus(parsed.data.userId));
}

export async function deviceStartRoute(
	request: Request,
	transport: CodexFetch = fetch,
): Promise<Response> {
	const parsed = codexBridgeUser.safeParse(await body(request));
	if (!parsed.success) return malformed();
	return refusing(async () =>
		Response.json(await startDeviceLogin(parsed.data.userId, transport)),
	);
}

export async function devicePollRoute(
	request: Request,
	transport: CodexFetch = fetch,
): Promise<Response> {
	const parsed = codexBridgeUser.safeParse(await body(request));
	if (!parsed.success) return malformed();
	return Response.json(await pollDeviceLogin(parsed.data.userId, transport));
}

export async function apiKeyRoute(
	request: Request,
	transport: CodexFetch = fetch,
): Promise<Response> {
	const parsed = codexBridgeApiKey.safeParse(await body(request));
	if (!parsed.success) return malformed();
	return refusing(async () =>
		Response.json(
			await connectApiKey(parsed.data.userId, parsed.data.apiKey, transport),
		),
	);
}

export async function modelsRoute(
	request: Request,
	transport: CodexFetch = fetch,
): Promise<Response> {
	const parsed = codexBridgeUser.safeParse(await body(request));
	if (!parsed.success) return malformed();
	return Response.json(await listCodexModels(parsed.data.userId, transport));
}

export async function chooseModelRoute(
	request: Request,
	transport: CodexFetch = fetch,
): Promise<Response> {
	const parsed = codexBridgeModel.safeParse(await body(request));
	if (!parsed.success) return malformed();
	const { userId, modelId, contextWindowTokens } = parsed.data;
	const status: CodexStatus = await codexStatus(userId);
	if (!status.connected)
		return Response.json({ error: "Codex is not connected." }, { status: 422 });
	if (modelId === null)
		return Response.json(await chooseCodexModel(userId, null));
	const catalog = await listCodexModels(userId, transport);
	if (!catalog.available)
		return Response.json(
			{ error: catalog.reason ?? "The model list is unavailable." },
			{ status: 422 },
		);
	const model = catalog.models.find((entry) => entry.id === modelId);
	if (!model)
		return Response.json(
			{ error: `Your connection does not offer a model called "${modelId}".` },
			{ status: 422 },
		);
	const window = model.contextWindowTokens ?? contextWindowTokens;
	if (window === null)
		return Response.json(
			{
				error:
					"That model does not publish its context window. Enter the context window in tokens.",
			},
			{ status: 422 },
		);
	return Response.json(
		await chooseCodexModel(userId, {
			id: model.id,
			contextWindowTokens: window,
		}),
	);
}

export async function disconnectRoute(
	request: Request,
	transport: CodexFetch = fetch,
): Promise<Response> {
	const parsed = codexBridgeUser.safeParse(await body(request));
	if (!parsed.success) return malformed();
	return Response.json(await disconnectCodex(parsed.data.userId, transport));
}
