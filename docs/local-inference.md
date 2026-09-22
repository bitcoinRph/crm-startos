# Inference modes

## Operator configuration

The agent has two explicit modes. An empty or unknown value disables inference.

```dotenv
CRM_INFERENCE_MODE="LOCAL"
CRM_LOCAL_INFERENCE_ALLOWED_HOSTS="local-inference.internal"
CRM_LOCAL_INFERENCE_JSON='{"baseURL":"http://local-inference.internal:11434/v1","modelId":"replace-with-installed-model","contextWindowTokens":4096,"maxOutputTokens":1024}'
```

`LOCAL` uses only the configured local Chat Completions endpoint.
`LEGACY_GATEWAY` restores the upstream Gateway model selection, model catalog, builder, and runner.
No mode is selected by default in this repository.
Deployment packages must select their intended default explicitly.
Only deployment administrators control these values.
The browser and API do not change them.
Turbo passes all three values through its strict environment.

## Session contract

A session stores its inference mode when the session starts.
A mode change rejects the next step and requires a new conversation.
Local route identity includes the endpoint, model, context budget, output budget, and adapter profile.
A local route change also rejects continuation.
Existing conversations and deployed version model IDs never move to another destination.
A runner in `LEGACY_GATEWAY` uses the model stored on its immutable deployed version.
There is no local-to-Gateway fallback.
Missing or invalid local configuration returns a deny-only model.

## Local profile

The local profile requires Ollama 0.34.0 and exactly 4096 declared context tokens.
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
Operators must load the selected runner before inference.

The public `@ai-sdk/openai` Chat Completions adapter owns serialization and streaming.
The wrapper forces `reasoningEffort` to `none` for generation and streaming.
It forces strict JSON schemas and caps output.
Callers cannot replace these controls.

## Feature availability

| Feature | LOCAL | LEGACY_GATEWAY |
| --- | --- | --- |
| Fixed sales extraction workflow | Available | Available |
| Root research chat | Bounded local profile | Upstream Gateway behavior |
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
bun test test/inference-mode.spec.ts test/local-inference.spec.ts test/local-profile.spec.ts test/local-routing.spec.ts test/local-wiring.spec.ts test/model.integration.spec.ts
bun run check-types
```

From `apps/app`:

```sh
bun test test/local-inference-settings.spec.tsx
```

Unit tests use synthetic transport and no database.
A successful unit test does not establish browser, database, packaging, or live inference acceptance.

## Issues

1. NOT DONE — Local mode does not support agent builder or runner delegation.
   Fix: keep specialist model selection denied in local mode.
2. RISK — Runner verification is not an atomic allocation lease.
   Fix: keep operator-managed allocation stable before release.
3. NOT DONE — Full CRM prompts and tools are not validated in the 4096-token profile.
   Fix: use an approved disposable CRM environment before production use.
4. NOT DONE — Codex and OpenWebUI adapters are unavailable.
   Fix: keep these options absent until their credential and consent designs pass review.
