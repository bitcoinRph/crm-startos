# Review of PR #8 — local-first inference and sales proposal review

Branch `local-first-inference` at `9fd9b6b`, base `main` at `1bbc902`.
78 files, +5042 / −265, two commits. Commit `9fd9b6b` ("ci: run draft review
checks") is empty. It changes no file.

Written in ASD-STE100 because `AGENTS.md` requires it for every report.

## 1. What I ran

| Step | Command | Result |
| --- | --- | --- |
| Toolchain | Bun 1.3.12 (repo `packageManager`), Node 24, PostgreSQL 16 local | see deviations |
| Install | `bun install --frozen-lockfile` | PASS, no lockfile drift |
| Database | `bun run db:deploy` on `crm_pr8`; `bun run db:test` | PASS, 115 db tests |
| Types | `bun run check-types` | PASS |
| Lint | `bun run lint`, `bun run lint:slop` | PASS |
| Dead code | `bun run lint:dead` (knip) | FAIL, exit 1 (see 1.2) |
| Tests | `bun run test` | PASS, 1302 tests, 0 fail |
| StartOS tests | `bun test` in `deploy/startos` | PASS, 4 tests |
| tRPC codegen | `bun run trpc:generate` in `apps/api` | no diff, generated file is current |
| PR CI on `9fd9b6b` | GitHub check runs | `check-types, lint, test` success; x86 and arm `.s9pk` builds success |

Deviations from the brief:

- No Docker daemon in this sandbox. `docker compose up -d` is not possible.
  I ran PostgreSQL 16 locally instead of the `postgres:17-alpine` container.
  The migration and every DB test pass on 16. StartOS ships 17.11.
- Bun 1.3.12 is not the sandbox default. I downloaded the 1.3.12 binary and
  put it first on `PATH` for every command above.

### 1.1 The "176 focused tests" claim

The claim holds for the `.spec.ts` files the PR touches. It omits two
`.spec.tsx` files the PR also adds.

| Suite | Tests |
| --- | --- |
| `apps/agent/test/*` (7 files touched) | 46 |
| `apps/api/test/*` (4 files) | 100 |
| `apps/app/test/onboarding-gate.spec.ts` | 26 |
| `deploy/startos/test/configureLocalInference.spec.ts` | 4 |
| Subtotal | **176** |
| `apps/app/test/local-inference-settings.spec.tsx` | 5 |
| `apps/app/test/sales-workflow.spec.tsx` | 3 |
| Total in PR-touched files | **184** |

All 184 pass on Bun 1.3.12.

### 1.2 knip

`lint:dead` reports 4 unused dependencies, 42 unused exports, 45 unused
exported types and 8 configuration hints. knip is not in CI (`ci.yml` runs
`check-types`, `lint`, `lint:slop`, `test`). I did not run knip on the base
commit. By inspection, one finding is new in this PR: the `Gate` type export
in `apps/app/lib/onboarding.ts:11` lost its last external user when the PR
deleted `readResearchGate`. Every other finding sits in a file the PR does
not touch.

## 2. Facts that drive the findings

### 2.1 StartOS Ollama

Source: `Start9Labs/ollama-startos` and the SDK 2.0.9 types installed in
`deploy/startos/node_modules`.

- Package id `ollama`, image `ollama/ollama:0.34.0`, internal port 11434,
  host id `api-multi`, interface id `api`, protocol `http`, no auth, health
  check = port listening.
- Another package reaches it only through
  `sdk.host.getBridgeAddress(effects, { packageId: 'ollama', hostId: 'api-multi', internalPort: 11434 })`.
  That returns `10.0.3.1:<port>`. The port is assigned at runtime.
- `ollama.embassy`, `ollama.startos` and `127.0.0.1` do not reach it. The
  CRM subcontainer has its own loopback. The packaging guide forbids
  fabricated addresses.
- The manifest must declare the dependency. This PR leaves
  `dependencies: {}` (`deploy/startos/startos/manifest/index.ts:26`) and
  `setupDependencies` empty (`deploy/startos/startos/dependencies.ts`).

### 2.2 Ollama 0.34.0 API

Source: `ollama/ollama` docs and `api/types.go` at tag `v0.34.0`.

- The local API takes no auth. A Bearer header is ignored.
- `/v1/chat/completions` cannot set `num_ctx`. Context comes from the loaded
  runner, from a Modelfile `PARAMETER num_ctx`, or from
  `OLLAMA_CONTEXT_LENGTH`. The Modelfile reference documents 2048 as the
  `num_ctx` default.
- `/api/generate` accepts `options.num_ctx` and `keep_alive`. The PR uses
  this as a warm-up on the sales path only.
- `/api/ps` returns `context_length` per loaded model. `ProcessModelResponse`
  in `api/types.go` at `v0.34.0` has `ContextLength int json:"context_length"`.
  The PR's check in `apps/agent/agent/lib/inference/local.ts:116` matches
  reality.
- `/api/ps` lists loaded models only. After `keep_alive` expires (default
  5 minutes) the list is empty.

### 2.3 Prompt size in the 4096-token profile

`apps/agent/agent/lib/preamble.ts` literals ≈ 1400 tokens. The 27 root tool
definitions ≈ 3750 tokens. Root system input ≈ 5150 tokens before any user
message. That exceeds the 4096-token profile pinned in
`apps/agent/agent/agent.ts:17`. The sales extraction prompt (≈ 276 tokens
plus ≤ 2048 bytes of source) fits.

### 2.4 Agent frameworks (official docs from GitHub)

Hermes Agent (`~/.hermes/config.yaml`, `mcp_servers.<name>`): `url`,
`headers` with `${ENV}` substitution from `~/.hermes/.env`, `transport`
auto-detect (Streamable HTTP, SSE fallback), `trust: untrusted` uses the
tool's `readOnlyHint`, `tools.include/exclude`, `timeout 300`,
`connect_timeout 60`.

OpenClaw (`mcp.servers.<name>`): `url`, `transport: "streamable-http"`,
`headers: { Authorization: "Bearer ${MCP_REMOTE_TOKEN}" }`,
`openclaw mcp add --transport streamable-http --header`, per-tool policy
gating, headers redacted in logs, `openclaw mcp doctor` warns on literal
secrets. Skills are Markdown instruction files, not HTTP callers.

Lowest common denominator, which the CRM already serves
(`apps/api/src/mcp/mcp-bridge.ts`, unchanged by the PR): stateless
Streamable HTTP with JSON responses, `Authorization: Bearer crm_…` or
`x-api-key`, strict object JSON schemas, `readOnlyHint` on queries.

Nothing in the PR's key profile is Hermes-specific. `hermes_sales` is a
name only (`apps/api/src/api-keys/api-keys.contracts.ts:10`,
`api-keys.service.ts:39`).

### 2.5 Cloud dependencies on StartOS

| Dependency | Status on StartOS |
| --- | --- |
| eve runtime | Self-hosted. `eve build && eve start`. Workflow world persists in the `main` volume at `agent/workflow-data` (`main.ts`). OK. |
| eve build | `eve build` reads model metadata from the Vercel AI Gateway (`deploy/startos/AGENTS.md`). The image build needs egress. RISK for offline rebuilds. |
| Vercel AI Gateway | Only in `LEGACY_GATEWAY` mode with a stored key. Off by default. OK. |
| Model catalog `ai-gateway.vercel.sh/v1/models` | `GET /settings/model-catalog` still exists. The settings page hides the catalog in `LOCAL` mode. A direct call still egresses. Nice-to-have N4. |
| Vercel Sandbox | Not used. just-bash in process. OK. |
| Vercel Blob | `mirror()` returns null without a token. No filesystem backend. Follow-up (FOLLOWUPS.md). |
| Neon | No Neon code. PostgreSQL 17 sidecar. OK. |
| Upstash / Redis | In-memory fallback. OK for one process. |
| Vercel OIDC | Evals only. N/A. |
| Telemetry | `CRM_TELEMETRY_DISABLED=1` unless the action enables it. OK. |

### 2.6 Sign-in for one user

- Password sign-in exists (`PASSWORD_SIGN_IN`, the `local-account` oneshot,
  the **Set Sign-in Credentials** action). No clearnet domain needed.
- The app calls the API same-origin through its own `/api/*` proxy
  (`apps/app/lib/env.ts`). `AUTH_COOKIE_DOMAIN` is unnecessary on StartOS.
- Google sign-in needs a public domain and a Google OAuth client. It is the
  only way to get Gmail and Calendar sync. That sync sends CRM-relevant mail
  through Google's API; the mail is already at Google.
- Settings → SSO registers an external OIDC or SAML provider
  (`registerSsoProviderInput`). The CRM is not an identity provider.

Recommendation: password sign-in. Add Google only for Gmail sync.

### 2.7 Backup path fix in the PR is correct

`Backups.withPgDump` mounts the whole `dbVolume` at `mountpoint` with
`subpath: null` and uses `mountpoint + pgdataPath` as PGDATA
(`node_modules/@start9labs/start-sdk/lib/backup/Backups.js:141-155`). The
running PostgreSQL uses volume subpath `postgresql` at `/var/lib/postgresql`
with `PGDATA=/var/lib/postgresql/data`. In the backup container PGDATA is
`/var/lib/postgresql/postgresql/data`, so `pgdataPath: '/postgresql/data'`
is right and the old `'/data'` was wrong. **Backups on `startos-v1.15.3-1`
are broken today.** See S1 for the split.

## 3. Findings

Format: file:line — problem — fix — verification.

### 3.1 Blockers

**B1. StartOS cannot reach Ollama with this PR.**
`deploy/startos/startos/fileModels/store.json.ts:33`,
`deploy/startos/startos/actions/configureLocalInference.ts:36-38,71`,
`deploy/startos/startos/manifest/index.ts:26`,
`deploy/startos/startos/dependencies.ts`,
`deploy/startos/startos/main.ts:69-91`.
The allow-list is `ollama.embassy | localhost | 127.0.0.1 | [::1]`. None of
these resolve to the Ollama service from the CRM container (2.1). No
dependency is declared. `README.md:144` states "No … dependency is
introduced". The **Configure Local Inference** action cannot produce a working
endpoint on StartOS.
Fix: declare `ollama` as an optional dependency in the manifest; in
`dependencies.ts` require it when `agent.localInference` is set, with the
health check on its `api` interface; in `main.ts` read
`getBridgeAddress(...)`, build `baseURL = http://<bridge>/v1`, set
`CRM_LOCAL_INFERENCE_ALLOWED_HOSTS` to the bridge host, and pass the result
in `CRM_LOCAL_INFERENCE_JSON`. Remove the URL input from the action; keep
model id and max output tokens. Delete the three host allow-lists in
`deploy/startos`. Update README and instructions.
Verification: `npm run check` and `bun test` in `deploy/startos` with a
mocked bridge address; `make x86` or CI build; on the server, the dependency
shows in the service page and `/api/version` answers from the CRM container.

**B2. Nothing processes a sales request in production.**
`apps/agent/scripts/sales-worker.ts:12-15`,
`apps/agent/agent/lib/sales-workflow.ts:15`.
`processSalesRequest` has one caller: a script that reads a fixture file
from `argv[2]`, polls a hard-coded `http://127.0.0.1:33071/rest`, handles one
request and exits. No eve task or schedule calls it. A request created with
`sales_create_request` on StartOS stays `PENDING` forever unless an external
agent drains it through `sales_pending_requests` and `sales_store_proposal`.
The PR contains two proposal paths and ships neither end to end.
Fix: decide (Open decision D2). Recommended: keep the MCP path as the
supported path for this PR, move `sales-worker.ts` to `apps/agent/test/` as
a fixture-driven test helper, and state in `docs/sales-milestone.md` that
in-CRM extraction is a follow-up.
Verification: smoke script (Phase 3) creates a request, stores a proposal
through MCP with a scoped key, approves in the browser session.

**B3. Root chat in `LOCAL` mode does not work in practice.**
`apps/agent/agent/lib/inference/local.ts:119-146`,
`apps/agent/agent/agent.ts:17`, `docs/local-inference.md:95`.
Two causes. (a) `verifyRunner` requires the model in `/api/ps` with
`context_length ≥ 4096` before every request and the root path has no
warm-up. After `keep_alive` expires every root message fails with
`LOCAL_INFERENCE_CONTEXT_UNVERIFIED`. The sales warm-up sets `keep_alive`
to 2 minutes (`sales-extraction.ts:154`), which shortens the window further.
(b) The root prompt plus tools is ≈ 5150 tokens (2.3), above the pinned 4096.
The PR itself lists this as NOT DONE.
Fix: decide (Open decision D3). Recommended for this PR: deny the root role
in `LOCAL` mode the same way builder and runner are denied
(`model.ts:162,174`), and show "Local mode runs sales extraction only" in
Settings. Warm-up plus a measured larger profile is a follow-up.
Verification: unit test that root selection in `LOCAL` returns the denied
model; settings spec.

**B4. The scoped key profile is unreachable from the UI, and it is named
after one framework.**
`apps/app/app/(app)/[slug]/settings/api-keys/create-api-key-sheet.tsx`,
`apps/api/src/api-keys/api-keys.contracts.ts:9-11`,
`apps/api/src/api-keys/api-keys.service.ts:37-40`,
`apps/api/src/trpc/api-key-access.ts:43`.
The sheet has no profile field, so every UI-created key is
`crm_integration`. `apiKeys.*` is denied to API keys, so no agent can mint
one either. The goal "scoped, revocable keys per agent" is not reachable.
Fix: rename profiles to capability names — `crm_integration` stays
(`crm:read`, `crm:write`), `agent_propose` = `crm:read`, `sales:read`,
`sales:proposal:write`, `agent_read` = `crm:read`. The existing free-text
`name` (`api-keys.contracts.ts:8`) is the label ("hermes", "openclaw"). Add a
profile select to the sheet from `packages/ui`, show the profile in the
table, return `profile` in `apiKeySummaryOutput`.
Verification: contracts test, `api-key-compatibility.spec.ts`, UI spec,
smoke script creates one key per framework and proves `sales_store_proposal`
works with `agent_propose` and fails with `agent_read`.

### 3.2 Should-fix

**S1. Split the backup path fix into its own PR and release it first.**
`deploy/startos/startos/backups.ts:10`. The fix is correct (2.7) and
unrelated to inference. Current releases cannot back up. One-line PR against
`main`, then a package version bump and release.
Verification: scripted backup → restore on a disposable install (Phase 3).

**S2. Version literals in two places; any Start9 Ollama update breaks
inference until a CRM release.**
`apps/agent/agent/lib/inference/local.ts:8,131`,
`apps/agent/agent/lib/sales-extraction.ts:131`.
`AGENTS.md` requires one config module per area. The check also throws
without naming the version it found.
Fix: `apps/agent/agent/lib/inference/config.ts` with
`LOCAL_INFERENCE.runner.verifiedVersions = ["0.34.0"] as const`; both call
sites import it; the error message includes the found version.
Verification: unit test with `{ version: "0.35.0" }` → rejected, message
names `0.35.0`.

**S3. Conversations opened before the upgrade fail with a misleading message
in `LEGACY_GATEWAY` mode.**
`apps/agent/agent/lib/model.ts:113,156,167-176`.
eve fires `session.started` once per session (`node_modules/eve/docs/agent-config.md:73`).
A resumed pre-upgrade session never runs `initializeInferenceSession`; state
`mode` stays `null`; `step.started` returns `null`; the selection falls to
`fallback = unavailableModel()`, whose error says "Configure local
inference". The operator is in legacy mode.
Fix: in `step.started`, when `mode` is `null`, bind the mode and, in
`LEGACY_GATEWAY`, return `selectedLegacyModel()`; rename the fallback error
to `INFERENCE_UNAVAILABLE: start a new conversation`.
Verification: unit test that drives `step.started` without
`session.started` in each mode.

**S4. Proposals carry no key attribution.**
`packages/db/prisma/migrations/20260922000000_sales_proposals/migration.sql`,
`apps/api/src/sales/sales.service.ts:117-160`, `sales.auth.ts:28-45`.
`salesRequest.requestedById` and the proposal hold a user id only. On a
one-user install every key maps to the same user, so the audit cannot say
whether Hermes or OpenClaw stored a proposal. `verifyApiKey` already returns
`key.id`.
Fix: add nullable `requestedByKeyId` and `proposedByKeyId` columns in a new
migration; `SalesActor` of kind `apiKey` carries `keyId`; write it on
create and store; show it on the sales page and in `sales_get_request`.
Verification: `sales-auth.spec.ts`, DB-backed test, smoke script asserts the
key id on the stored proposal.

**S5. No real-database concurrency test for the locking paths.**
`apps/api/test/sales.spec.ts` uses an in-memory fixture. `SELECT … FOR
UPDATE` in `sales.service.ts:118,188,201` is never exercised. The PR body
says an earlier run verified it "before the latest refinements".
Fix: a DB-backed test in the `db:test` harness that fires two concurrent
`approveProposal` calls and asserts one title write, one NOTE, one TASK, one
`approvedAt`.
Verification: `bun run db:test`.

**S6. `profileId` and `profileRevision` come from the client but the schema
admits one literal.**
`apps/api/src/sales/sales.service.ts:71-72`, `migration.sql:9-10`,
`packages/validation/src/sales.ts`.
Every client must send `qwen-local-experimental` / `sales-qwen-v1`, also an
external agent using another model. The label lies about provenance. The
CHECK also makes every profile revision a migration.
Fix: the API sets `profileId` from server config for the in-CRM path and
records the caller's model claim as free text on the proposal
(`producedBy` ≤ 120 chars); drop the two literal CHECKs, keep the
immutability triggers.
Verification: validation test, DB test, `sales_store_proposal` through MCP
with `producedBy: "hermes/claude-…"`.

**S7. The sales page has no navigation entry and uses "synthetic" copy.**
`apps/app/app/(app)/[slug]/sales/page.tsx:24`; no link to `/[slug]/sales`
anywhere in `apps/app/components` or `apps/app/lib`.
Fix: sidebar entry in the existing navigation component; replace the
description with "Review evidence-backed proposals before they change a
contact."
Verification: `sales-workflow.spec.tsx`, manual click path.

**S8. Call-site styling on the sales page.**
`apps/app/app/(app)/[slug]/sales/sales-workflow.tsx:216,222,318,338,341`.
`<dl className="grid gap-2 break-words">`, `<dd className="whitespace-pre-wrap">`,
raw `<p role="alert">` and `<p role="status">`. `docs/design.md`: shared
components only, no call-site className.
Fix: use `Alert` for alerts and a `DescriptionList` primitive; add the
primitive to `packages/ui` if missing.
Verification: `lint`, spec, visual check.

**S9. REST verb mismatch on a query.**
`apps/api/src/sales/sales.router.ts:92`: `pendingRequests` is a `@Query`
exposed as `POST /sales/requests/pending`; `getRequest` at line 54 is `GET`.
Fix: `GET /sales/requests/pending`; update the only caller (B2).
Verification: REST bridge test, `trpc:generate` diff.

**S10. Research-gate leftovers.**
`apps/app/proxy.ts:7,83` still imports `RESEARCH_PATH` and keeps
`/onboarding/research` ungated; `apps/app/app/(landing)/onboarding/research/page.tsx`
survives as a redirect; `Gate` at `apps/app/lib/onboarding.ts:11` is an
unused export (1.2).
Fix: delete the route, the constant and the export.
Verification: `onboarding-gate.spec.ts`, knip count drops by one.

**S11. No MCP tool to fail a request.**
`apps/api/src/mcp/mcp-tools.ts:8-30`. REST has `POST /sales/requests/fail`;
MCP does not. An external agent that cannot extract has no way to release
the request.
Fix: add `sales_fail_request` mapped to `sales.failRequest`, scope
`sales:proposal:write`.
Verification: MCP bridge test lists the tool; smoke script.

**S12. Legacy keys keep full write access and the table does not say so.**
`apps/api/src/trpc/api-key-access.ts:44`,
`apps/app/app/(app)/[slug]/settings/api-keys/api-keys-table.tsx`.
Documented as compatibility. On this install keys from the first release
exist.
Fix: show "Legacy — full access, rotate" for `permissions == null` rows
(with B4's `profile` column).
Verification: UI spec.

**S13. Docs contradict the StartOS reality.**
`docs/local-inference.md:10` shows `http://local-inference.internal:11434/v1`,
which the allow-list rejects; `deploy/startos/README.md:144` says no
dependency; `deploy/startos/instructions.md:21` says "the model must already
be installed and available" with no way to do that.
Fix: rewrite with B1; add the Ollama install and `ollama pull` steps.
Verification: docs review.

### 3.3 Nice-to-have

**N1. Dockerfile runs as root** (`Dockerfile:1`, no `USER`). Pre-existing,
not in this PR. Separate PR: `USER node`, volume ownership in `main.ts`.

**N2. `scripts/check-local-inference-turbo.py`** is a Python check in a Bun
repository. Replace with a `bun test` that reads `turbo.json`, or drop it.

**N3. Empty commit `9fd9b6b`** claims a CI change that does not exist.
Squash-merge removes it. Note it in the PR body.

**N4. Model catalog egress.** `GET /settings/model-catalog` still calls
`ai-gateway.vercel.sh` in `LOCAL` mode when called directly. Return an
empty list when `CRM_INFERENCE_MODE !== "LEGACY_GATEWAY"`.

**N5. Ports in `EXPOSE`** (`Dockerfile`: 3000, 3001, 2000) are unused by
StartOS; harmless.

### 3.4 Verified OK (no change)

- Mode isolation is fail-closed: `LOCAL` never selects Gateway
  (`model.ts:161-165`, `routing.ts`); a config change mid-session is
  denied (`local-routing.spec.ts`).
- Destination pinning: `local.ts:153-156` rejects any URL other than
  `${baseURL}/chat/completions`, deletes `authorization`, `redirect: "error"`.
  SSRF surface is the allow-list only; B1 removes user input entirely.
- Approval: session only with a live `session` row, proposal and contact
  locked `FOR UPDATE`, revision check, idempotent replay, one `$transaction`
  (`sales.service.ts:171-280`).
- No automatic fact admission: approval writes `contact.title` and
  `activity` rows with proposal ids in `meta`; nothing touches `Fact`.
- Evidence: exact substring, `value === evidence`, one op per type, ≤ 3 ops,
  ≤ 2048 bytes source (`sales-extraction.ts`, `validation/src/sales.ts`);
  rows immutable by trigger.
- Prompt injection on the sales path: the system prompt marks source as
  data; structured output with a strict schema; `reasoningEffort: "none"`.
- Secrets in logs: request logger writes method, path, status, duration, IP,
  user agent. `CRM_LOCAL_INFERENCE_JSON` holds no secret.
- `apiKeys.*` denied to keys; approval denied to keys; `readOnlyHint` on
  queries.
- Bun is already pinned: `package.json` `packageManager: bun@1.3.12`,
  `devEngines`, CI `bun-version-file: package.json`. Nothing to add.
- StartOS package version and migrations untouched: correct for a draft.

## 4. Where the repo rules override the brief

- **Report style.** `AGENTS.md` mandates ASD-STE100 and an `## Issues` list
  in every message. This review and every later message follow it.
- **Commit trailers.** The repo forbids `Co-Authored-By`. Commits carry only
  the `Claude-Session` line, as in PRs #1–#7.
- **Median task ids.** `AGENTS.md` asks for an `MDN-…` id in every commit
  and PR title. There is no `.median/config.json` in the repo and no `mdn`
  binding in this session. PRs #1–#7 used Conventional Commit titles without
  an id. I will do the same unless you give me a task id.
- **Constants.** The brief accepts the PR's inline literals; the repo rule
  (one config module per area) wins → S2.
- **UI.** The brief does not mention design rules; `docs/design.md` wins →
  S8.

## 5. Open decisions

**D1. Sign-in.** Recommendation: password sign-in (already shipped). Add
Google only if you want Gmail and Calendar sync and have a public domain.

**D2. Which proposal path does this PR ship?** (B2)
Options: (a) MCP path only — external agent extracts and stores; the CRM
approves. Recommended. (b) In-CRM extraction — add an eve schedule that
drains pending requests with the local model. More code, needs B3's warm-up.
(c) Both — largest scope.

**D3. Root chat in `LOCAL` mode.** (B3)
Options: (a) deny root in `LOCAL` for this PR; local mode = sales extraction.
Recommended. (b) add warm-up and keep 4096; root still overflows. (c) add
warm-up and raise the profile after measuring on your hardware.

**D4. Server architecture.** The manifest builds `x86_64` and `aarch64`;
CI produced both `.s9pk`. Tell me which one your server runs so the smoke
test and the sideload instructions name one file.

**D5. Split the PR.** Recommendation: three PRs in this order —
(1) backup path fix (S1), (2) scoped key profiles + UI + attribution
(B4, S4, S12), (3) inference modes + sales workflow + StartOS Ollama
dependency (B1, B2, B3, rest). Each is reviewable and releasable alone.

**D6. eve outside Vercel.** Runtime is fine (2.5). The image build needs
Gateway egress. Accept, or investigate an offline model-metadata cache in a
follow-up.

**D7. Version pin policy** (S2). Keep an exact verified list, or accept any
`0.34.x`.

## 6. Change plan (Phase 3, after your approval)

Each step is one commit on `local-first-inference`, tests first, full
`check-types` + `lint` + `lint:slop` + `test` after each.

1. **Backup path fix as its own PR** (S1) → current releases cannot back up
   → scripted backup/restore on a disposable install; `make x86`.
2. **Generic key profiles + UI selector + profile column** (B4, S12) →
   scoped keys per agent, framework neutral → contracts and UI specs; smoke
   script creates `hermes` and `openclaw` keys.
3. **Key attribution on requests and proposals** (S4, S6) → audit shows
   which key proposed → new migration, DB-backed test, `sales_get_request`
   shows the key id.
4. **Ollama dependency + bridge address in the StartOS package** (B1, S13)
   → the only way to reach Ollama on StartOS → `deploy/startos` tests with a
   mocked bridge address; CI `.s9pk` build; server check.
5. **One inference config module with a version list** (S2) → repo rule;
   clearer failures → unit test with an unverified version.
6. **Root denied in `LOCAL`; settings copy** (B3 per D3) → local mode is
   honest about what it supports → unit test, settings spec.
7. **Step-scope mode binding + neutral error** (S3) → old conversations
   keep working in legacy mode → unit test without `session.started`.
8. **MCP `sales_fail_request`; `GET` for pending** (S9, S11) → external
   agents can release a request → bridge test, `trpc:generate` diff.
9. **Sales worker to test helper; docs state the supported path** (B2 per
   D2) → no dead production path → `bun test`.
10. **DB-backed concurrency test** (S5) → proves `FOR UPDATE` → `db:test`.
11. **Sales page: navigation, copy, shared components** (S7, S8) →
    reachable and on-design → specs, manual check.
12. **Research-gate leftovers** (S10) → dead code out → knip count −1.
13. **`docs/agents-integration.md`** with Hermes and OpenClaw configs, and
    **`scripts/smoke-startos.sh`** → copy-paste onboarding and a repeatable
    end-to-end check → run the script against a local stack; against the
    server after install.
14. **End-to-end local path** with a mocked Ollama (`/api/version`,
    `/api/tags`, `/api/generate`, `/api/ps`, `/v1/chat/completions`) →
    proves the guarded adapter end to end without hardware → labelled test.
15. **`FOLLOWUPS.md`** (Phase 4: MCP/API matrix, Codex in CRM, OpenWebUI,
    Blob → volume, warm-up and larger local profile).

Not planned unless you ask: root chat on the local model (D3), in-CRM
extraction scheduler (D2b), Dockerfile non-root (N1), Codex OAuth.

## Issues

1. BROKEN — StartOS cannot reach Ollama with the PR's allow-list. Local
   inference never starts on the box.
   Fix: not done. Plan step 4 (B1). Needs your approval.
2. BROKEN — No production caller of `processSalesRequest`. Requests stay
   pending.
   Fix: not done. Plan step 9 (B2). Needs decision D2.
3. BROKEN — Root chat in `LOCAL` mode fails after `keep_alive` and exceeds
   4096 tokens.
   Fix: not done. Plan step 6 (B3). Needs decision D3.
4. BROKEN — Backups on the current release fail; the PR's fix is correct but
   unreleased.
   Fix: not done. Plan step 1 (S1).
5. BROKEN — `hermes_sales` keys cannot be created from the UI.
   Fix: not done. Plan step 2 (B4).
6. RISK — Pre-upgrade conversations fail in legacy mode with a local-inference
   error.
   Fix: not done. Plan step 7 (S3).
7. RISK — Proposals do not record which key stored them.
   Fix: not done. Plan step 3 (S4).
8. RISK — knip fails on this branch; one new finding, the rest pre-existing.
   knip is not in CI.
   Fix: not done. Plan step 12 removes the new one.
9. NOT DONE — `docker compose` did not run; PostgreSQL 16 stood in for 17.
   Fix: CI and the StartOS package use 17; Phase 3 DB tests run on 17 if
   Docker is available there, else stay on 16 and say so.
10. NOT DONE — Real Ollama end-to-end test. No GPU or Ollama in this sandbox.
    Fix: Phase 3 uses a labelled mocked Ollama; the smoke script runs on
    your server.
11. UNKNOWN — Server architecture (x86_64 or aarch64).
    Fix: decision D4.
