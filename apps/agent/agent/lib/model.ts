import { db } from "@crm/db";
import { DEFAULT_AGENT_MODEL, readAgentModel } from "@crm/db/settings";
import { type DynamicResolveContext, defineDynamic } from "eve";
import { defineState } from "eve/context";
import {
	type CodexBinding,
	codexBindingFor,
	codexSelection,
	humanCaller,
} from "./codex/selection";
import { createLocalInference, unavailableModel } from "./inference/local";
import {
	bindInferenceMode,
	type InferenceMode,
	modeFromEnvironment,
	stepDecision,
} from "./inference/mode";
import { attribute, purposeOf } from "./session-purpose";

export interface ModelSelection {
	model: string;
	modelContextWindowTokens: number;
}

type ModelRole = "root" | "builder" | "runner";
type InferenceContext = Pick<DynamicResolveContext, "session">;

const inferenceState = defineState("crm.inference-mode.v3", () => ({
	mode: null as InferenceMode | null,
	codex: null as CodexBinding | null,
}));

function configuredMode(): InferenceMode {
	return modeFromEnvironment(process.env.CRM_INFERENCE_MODE);
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

export function initializeInferenceSession(): InferenceMode {
	const current = inferenceState.get();
	const bound = bindInferenceMode(current, configuredMode());
	if (current.mode === null) inferenceState.update(() => bound);
	return bound.mode;
}

async function bindCodex(ctx: InferenceContext): Promise<CodexBinding | null> {
	const bound = inferenceState.get().codex;
	if (bound) return bound;
	if (purposeOf(ctx) !== "research") return null;
	const userId = humanCaller(ctx, "initiator") ?? humanCaller(ctx, "current");
	if (!userId) return null;
	const binding = await codexBindingFor(userId);
	if (binding) inferenceState.update((state) => ({ ...state, codex: binding }));
	return binding;
}

export function inferenceModel(role: ModelRole = "root") {
	const legacySelection = async (ctx: InferenceContext) =>
		role === "runner"
			? ((await pinnedRunnerModel(ctx)) ?? deniedSelection())
			: selectedLegacyModel();

	return defineDynamic({
		fallback: unavailableModel(),
		events: {
			"session.started": async (_event, ctx) => {
				const mode = initializeInferenceSession();
				if (role === "root" && (await bindCodex(ctx))) return null;
				if (mode !== "LEGACY_GATEWAY") return null;
				return legacySelection(ctx);
			},
			"step.started": async (_event, ctx) => {
				const codex = role === "root" ? inferenceState.get().codex : null;
				if (codex)
					return codexSelection(
						codex,
						humanCaller(ctx, "current"),
						deniedSelection,
					);
				const decision = stepDecision(inferenceState.get(), configuredMode());
				if (decision === "keep") return null;
				if (decision === "deny") return deniedSelection();
				inferenceState.update((state) => ({
					...state,
					mode: "LEGACY_GATEWAY",
				}));
				return legacySelection(ctx);
			},
		},
	});
}
