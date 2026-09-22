# Inference modes

## Operator configuration

The agent has two explicit modes. An empty or unknown value disables inference.

```dotenv
CRM_INFERENCE_MODE="LOCAL"
CRM_LOCAL_INFERENCE_ALLOWED_HOSTS="10.0.3.1"
CRM_LOCAL_INFERENCE_JSON='{"baseURL":"http://10.0.3.1:11434/v1","modelId":"qwen3.5:4b","contextWindowTokens":4096,"maxOutputTokens":1024}'
```

On StartOS the package computes all three from the Ollama dependency's bridge address; the operator enters only the model ID (`deploy/startos/README.md`, "Local inference").
`LOCAL` uses only the configured local Chat Completions endpoint, and only for the fixed sales extraction workflow.
`LEGACY_GATEWAY` restores the upstream Gateway model selection, model catalog, builder, and runner.
No mode is selected by default in this repository.
Deployment packages must select their intended default explicitly.
Only deployment administrators control these values.
The browser and API do not change them.
Turbo passes all three values through its strict environment.

## Session contract

A session binds its inference mode when it starts (`crm.inference-mode.v3` state).
`LEGACY_GATEWAY` selects the Gateway model at session start and keeps it for every step.
`LOCAL` and `DISABLED` select no model: every step returns the deny-only model.
A session that started before modes existed has no bound mode. Its first step binds `LEGACY_GATEWAY` when that is configured, and is denied otherwise.
A mode change after binding denies the next step. Start a new conversation.
Deployed version model IDs never move to another destination.
A runner in `LEGACY_GATEWAY` uses the model stored on its immutable deployed version.
There is no local-to-Gateway fallback.
The deny-only model fails with `INFERENCE_UNAVAILABLE`.

## Local profile

The local profile requires a verified Ollama version (`LOCAL_INFERENCE.runner.verifiedVersions` in `apps/agent/agent/lib/inference/config.ts`, currently `0.34.0`) and exactly 4096 declared context tokens.
An unverified version fails with the version it found and the verified list.
Output limits range from 1 through 1024 tokens.
The endpoint requires HTTP or HTTPS and the exact `/v1` path.
Credentials, query parameters, fragments, and redirects are rejected.
Loopback hosts are allowed by default.
Every other host must appear in `CRM_LOCAL_INFERENCE_ALLOWED_HOSTS`.
The adapter removes authorization headers.

Before every model request, the adapter reads `/api/version` and `/api/ps`.
It requires one matching loaded model and at least 4096 allocated context tokens.
Missing, ambiguous, smaller, malformed, or unavailable runner metadata blocks inference.
These read-only checks do not allocate runner memory.
The sales extraction path loads the runner itself with `/api/generate` (`num_ctx` 4096, `keep_alive` 2m) before the check.

The public `@ai-sdk/openai` Chat Completions adapter owns serialization and streaming.
The wrapper forces `reasoningEffort` to `none` for generation and streaming.
It forces strict JSON schemas and caps output.
Callers cannot replace these controls.

## Feature availability

| Feature | LOCAL | LEGACY_GATEWAY |
| --- | --- | --- |
| Fixed sales extraction workflow | Available | Available |
| Root research chat | Unavailable (the root prompt and tools exceed 4096 tokens; see FOLLOWUPS.md) | Upstream Gateway behavior |
| Agent builder | Unavailable | Available |
| Deployed agent runner | Unavailable | Available |
| Model catalog and model selection | Hidden | Available |
| Cloud fallback | Never | Gateway is the selected mode |
| Codex connection | Unavailable | Unavailable |
| OpenWebUI connection | Unavailable | Unavailable |

Builder and runner source stays under `apps/agent/agent/subagents/` for legacy mode.
Local specialist selection returns a deny-only model.
Local mode does not claim builder or runner feature parity.
No model-authored text grants specialist admission.

## Verification

From `apps/agent`:

```sh
bun test test/inference-mode.spec.ts test/local-inference.spec.ts test/local-profile.spec.ts test/local-wiring.spec.ts test/model.integration.spec.ts test/sales-extraction.spec.ts
bun run check-types
```

From `apps/app`:

```sh
bun test test/local-inference-settings.spec.tsx
```

Unit tests use synthetic transport and no database.
A successful unit test does not establish browser, database, packaging, or live inference acceptance.

## Issues

1. NOT DONE — Local mode does not run the research chat, the agent builder or the runner.
   Fix: not done. The root prompt with its 27 tools needs about 5150 tokens; a warm-up and a measured larger profile are a follow-up (`FOLLOWUPS.md`).
2. RISK — Runner verification is not an atomic allocation lease. Another client can unload or reload the model between the check and the request.
   Fix: not done. The sales path warms the model itself before each request, which narrows the window.
3. NOT DONE — Codex and OpenWebUI adapters are unavailable.
   Fix: not done. Designs in `FOLLOWUPS.md`.
