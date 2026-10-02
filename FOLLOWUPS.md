# Follow-ups

Designs for work that is deliberately not in the local-first inference PR. Each
one is a separate PR. Written in ASD-STE100 per `AGENTS.md`.

## A. Agent surface: MCP and REST

### Coverage today

| Capability | MCP tool | tRPC procedure | REST (`/rest`, API port only) |
| --- | --- | --- | --- |
| Search | `search_crm` | `search.quick` | `GET /search` |
| Read a record | `get_contact`, `get_company`, `get_deal`, `timeline`, `my_tasks`, `dashboard_summary`, `whoami`, `list_*` | same | same |
| Change a record | `create_*`, `update_*`, `set_deal_stage`, `attach_contact_to_deal`, `log_activity`, `complete_task`, `enrich_*` | same | same |
| Sales proposals | `sales_create_request`, `sales_get_request`, `sales_pending_requests`, `sales_store_proposal`, `sales_fail_request` | `sales.*` | `/sales/*` |
| Approve a proposal | none | `sales.approveProposal` (session only) | `POST /sales/proposals/approve` (session only) |
| Manage keys, SSO, tracking, purges, bulk | none | session only | session only |

### Decision: MCP is the agent surface

- On StartOS the web origin exposes `/api/mcp` and `/api/trpc/*`; the REST bridge
  sits on the API port, which the package does not expose. Every agent framework
  in scope (Hermes, OpenClaw, Claude Code, Codex) speaks Streamable HTTP MCP.
- REST stays for humans with `curl` and for the OpenAPI document. It gains no
  agent-only feature.
- One allow-list (`mcp-tools.ts`) decides what an agent sees. Adding a tool is
  one entry; adding a destructive one is a review.

### Minimal tool set per profile

`agent_read` needs 11 tools; `agent_propose` those plus the 5 sales tools;
`crm_integration` everything in the list. A future change filters `tools/list`
by the key's profile so an agent never sees a tool it cannot call.
Verification: an MCP `tools/list` per profile in a bridge test.

### Audit log per key

- `Apikey.lastRequest` is the only trace today. Add an `ApiKeyCall` table:
  `keyId`, `procedure`, `type`, `outcome` (`allowed`, `denied`), `createdAt`,
  written by `AuthMiddleware` after the decision, batched or fire-and-forget.
- Show the last 50 calls per key in Settings → API keys.
- Retention: prune with the archive cron at `archiveRetentionDays`.
- Never log arguments: they carry customer text.

## B. Codex in the CRM

Implemented in this branch; `docs/codex.md` is the reference. What is left:

- **OpenAI's sign-in program for apps.** OpenAI documents a separate "Sign in
  with ChatGPT" flow for open-source and locally run apps, with a per-app client
  and `api.openai.com/v1/responses`. This repository could not read those pages
  (egress-blocked), and the secondary source says it is loopback-only with no
  device flow. Verify it, then decide whether it replaces the Codex CLI client.
- **Builder and runner on Codex.** Only the research chat binds Codex today.
- **A per-thread egress badge.** The badge shows the user's connection state,
  not the route the open conversation bound at its start.
- **`tools/list` filtered by profile** (A) applies to the sales profiles too.

## C. OpenWebUI

- Point OpenWebUI at the same Ollama service; nothing in the CRM changes for
  chat.
- To let OpenWebUI act on the CRM, register the CRM as an OpenAPI tool server:
  `GET /openapi.json` already describes `/rest`. That needs the API port
  exposed as a second StartOS interface, or a small proxy route under `/api/`.
- Do this only if you want a chat UI for the local model. It adds an interface
  and a second place keys live.

## D. Root chat on the local model

- Measure: the root preamble plus 27 tools is about 5150 tokens (`REVIEW.md`,
  2.3). The verified profile is 4096.
- Warm-up: call `/api/generate` with `num_ctx` and `keep_alive` before
  verifying `/api/ps`, as the sales path does (`sales-extraction.ts`).
- Profile: measure a larger context on your hardware, add it to
  `LOCAL_INFERENCE` in `apps/agent/agent/lib/inference/config.ts`, and lift the
  4096 refinement in `parseLocalConfig` and the StartOS action.
- Then re-enable the root role in `model.ts` for `LOCAL`.

## E. Unattended in-CRM extraction

Implemented: `apps/agent/agent/lib/sales-worker.ts` runs on the dispatch tick
for the `crm-ollama` and `crm-codex` profiles, with a lease column so two ticks
never process one request. What is left: a real-Ollama run on StartOS, and a
retry policy (a failed request stays `FAILED` and the agent files a new one).

## F. Pictures on a StartOS volume

`packages/db/src/blob.ts` mirrors to Vercel Blob only. Add a filesystem backend
that writes under the `main` volume and serves through the app, keyed by the
same content hash. `isOptimizable` then allow-lists the CRM's own origin.

## G. Container hardening

The image runs as root (`Dockerfile`). Add `USER node` and give the mounted
volume paths to that user in `main.ts`.

## H. Dead-code gate

`bun run lint:dead` (knip) is not in CI and reports pre-existing findings. Fix
them, then add it to `ci.yml`.
