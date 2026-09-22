import { db } from "@crm/db";
import { DEFAULT_AGENT_MODEL, readAgentModel } from "@crm/db/settings";
import { type DynamicResolveContext, defineDynamic } from "eve";
import { defineState } from "eve/context";
import {
	createLocalInference,
	parseLocalConfig,
	selectionIdentity,
	unavailableModel,
} from "./inference/local";
import {
	bindInferenceMode,
	type InferenceMode,
	modeFromEnvironment,
} from "./inference/mode";
import { createLocalRouting } from "./inference/routing";
import { attribute, purposeOf } from "./session-purpose";

export interface ModelSelection {
	model: string;
	modelContextWindowTokens: number;
}

type ModelRole = "root" | "builder" | "runner";
type InferenceContext = Pick<DynamicResolveContext, "session">;

const inferenceState = defineState("crm.inference-mode.v2", () => ({
	mode: null as InferenceMode | null,
	identity: null as string | null,
	rootSessionId: null as string | null,
}));

function configuredMode(): InferenceMode {
	return modeFromEnvironment(process.env.CRM_INFERENCE_MODE);
}

function configuredLocalModel() {
	return parseLocalConfig(process.env.CRM_LOCAL_INFERENCE_JSON);
}

function deniedSelection() {
	return createLocalInference(null);
}

export async function selectedModel(): Promise<ModelSelection | null> {
	try {
		const setting = await readAgentModel(db);
		if (setting.isDefault) return null;
		return {
			model: setting.id,
			modelContextWindowTokens: setting.contextWindowTokens,
		};
	} catch (error) {
		console.error(
			`[agent] could not read the configured model, falling back: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
		return null;
	}
}

async function selectedLegacyModel(): Promise<ModelSelection> {
	return (
		(await selectedModel()) ?? {
			model: DEFAULT_AGENT_MODEL.id,
			modelContextWindowTokens: DEFAULT_AGENT_MODEL.contextWindowTokens,
		}
	);
}

async function pinnedRunnerModel(
	ctx: InferenceContext,
): Promise<ModelSelection | null> {
	if (purposeOf(ctx) !== "team-agent") return null;
	const runId = attribute(ctx, "runId");
	if (!runId) return null;
	const run = await db.agentRun.findUnique({
		where: { id: runId },
		select: {
			version: {
				select: { modelId: true, modelContextWindowTokens: true },
			},
		},
	});
	return run
		? {
				model: run.version.modelId,
				modelContextWindowTokens: run.version.modelContextWindowTokens,
			}
		: null;
}

export async function versionModel() {
	if (configuredMode() !== "LEGACY_GATEWAY") {
		throw new Error(
			"LEGACY_GATEWAY_REQUIRED: Agent builder and runner features require explicit legacy mode.",
		);
	}
	const selected = await selectedLegacyModel();
	return {
		id: selected.model,
		contextWindowTokens: selected.modelContextWindowTokens,
	};
}

export async function initializeInferenceSession(
	ctx: InferenceContext,
	isRoot = false,
) {
	const current = inferenceState.get();
	const bound = bindInferenceMode(current, configuredMode());
	if (current.mode !== null) return;
	const config = bound.mode === "LOCAL" ? configuredLocalModel() : null;
	inferenceState.update(() => ({
		...bound,
		identity: config ? selectionIdentity(config) : null,
		rootSessionId: isRoot ? ctx.session.id : null,
	}));
}

export function inferenceModel(role: ModelRole = "root") {
	const state = {
		get: () => inferenceState.get().identity,
		set: (identity: string | null) =>
			inferenceState.update((current) => ({ ...current, identity })),
	};
	const localRouting = (ctx: InferenceContext) =>
		createLocalRouting(
			state,
			configuredLocalModel,
			async (identity) => {
				if (purposeOf(ctx) !== "team-agent") return true;
				const runId = attribute(ctx, "runId");
				if (!runId) return false;
				const run = await db.agentRun.findUnique({
					where: { id: runId },
					select: {
						version: {
							select: { modelId: true, modelContextWindowTokens: true },
						},
					},
				});
				const config = configuredLocalModel();
				return (
					run?.version.modelId === identity &&
					run.version.modelContextWindowTokens === config?.contextWindowTokens
				);
			},
			() =>
				role === "root" &&
				inferenceState.get().rootSessionId === ctx.session.id,
		);

	return defineDynamic({
		fallback: unavailableModel(),
		events: {
			"session.started": async (_event, ctx) => {
				await initializeInferenceSession(ctx);
				const mode = inferenceState.get().mode;
				if (mode === "DISABLED") return deniedSelection();
				if (mode === "LOCAL") return role === "root" ? null : deniedSelection();
				if (role === "runner")
					return (await pinnedRunnerModel(ctx)) ?? deniedSelection();
				return selectedLegacyModel();
			},
			"step.started": (_event, ctx) => {
				try {
					bindInferenceMode(inferenceState.get(), configuredMode());
				} catch {
					return deniedSelection();
				}
				if (inferenceState.get().mode !== "LOCAL") return null;
				if (role !== "root") return deniedSelection();
				return localRouting(ctx).step();
			},
		},
	});
}
