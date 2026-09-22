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

### What must be true before any code

1. **Auth facts.** Codex signs in either with an OpenAI API key or with a
   ChatGPT account through an OAuth flow that Codex CLI performs itself. Read
   the current Codex CLI source and OpenAI's terms for the ChatGPT sign-in
   before designing around it. Do not assume a ChatGPT session token is
   usable by a third-party server.
2. **Terms.** Confirm in writing which credential OpenAI permits a self-hosted
   server to hold and call with. Ship only the credential the terms allow. The
   safe default is an API key the user creates for this CRM.

### Design when the terms allow it

- **Storage.** A `CodexConnection` row holds the credential encrypted with a
  key derived from a secret in the StartOS store (`store.json`), never in
  plaintext, never in a log, never returned by any tRPC, REST or MCP call. The
  UI shows only "connected as … since …" and the last four characters.
- **Connect / disconnect.** Two session-only tRPC mutations and a StartOS
  action **Connect Codex** for operators who prefer the service page. Disconnect
  deletes the row and revokes the token when the provider supports it.
- **Least privilege.** The connection runs only the code-review and drafting
  tasks the user starts from a record. It gets no CRM write tool. Its output is
  a proposal, approved like a sales proposal.
- **Egress indicator.** Every screen that can send text to OpenAI shows a
  persistent "Sends to OpenAI" badge (a `packages/ui` variant), and the send
  is a click, never automatic.
- **API-key fallback.** When ChatGPT sign-in is not permitted, the same row
  stores an OpenAI API key with the same encryption and the same UI.

Verification: a spec that reads every tRPC output schema and fails when a field
named `token`, `secret` or `apiKey` appears; a spec that the connect mutation
refuses an API key request; the smoke script extended with a disconnect.

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

`apps/agent/agent/lib/sales-extraction.ts` works against Ollama (mocked test:
`apps/agent/test/local-extraction-mock.spec.ts`). Nothing schedules it. Add an
eve schedule in `apps/agent/agent/schedules/` that, in `LOCAL` mode, reads
pending requests through the bridge, extracts, and stores proposals with a
`producedBy` of `crm-agent/<model>`. Requires a service credential for the
agent; the cleanest is a dedicated `agent_propose` key seeded by the StartOS
package.

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
