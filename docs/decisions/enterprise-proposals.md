# Decision proposals for the enterprise plan

Status: proposal. This file changes no code. The owner has not decided any item here.
Date: 2026-10-24. Base commit: `4b158fb`, branch `wip/p5`.
Language: ASD-STE100, as `AGENTS.md` requires.

## Business context

The CRM is the system of record for one operator. The operator runs an AI-agent-native company.
The operator is the only human user. Hermes and OpenClaw are API and MCP clients.
The CRM runs as a `.s9pk` on the operator's own Start9 server.
The goal is to replace HubSpot, Pipedrive and Salesforce for a small business.
A feature earns its place only by money earned, money saved or risk removed.

`docs/crm-plan.md:1358-1368` (section 15) puts several of these items out of scope on purpose.
The text says: "If sales asks for one, it is a new plan, not a phase" (`docs/crm-plan.md:1367-1368`).
This file is that new plan. Each recommendation below replaces the section 15 rule only if the owner approves it.

## How to read this file

- Every fact has a `path:line`. The author read each line in this worktree.
- A fact that the author cannot read here is marked UNKNOWN.
- Line numbers refer to base commit `4b158fb`. They move after later edits.
- Each proposal has the same six parts: Value, Cost, Migration, Risk, Simplest version, Recommendation.

## Summary

| ID | Topic | Recommendation |
| --- | --- | --- |
| D1 | Product name strings | Do later |
| D2 | Products, line items, quotes | Do not do |
| D3 | Invoices and payments | Do later |
| D4 | Sending email and sequences | Do later (drafts as notes now) |
| D5 | Multiple pipelines | Do not do |
| D6 | Read-only role | Do later |
| D7 | Interface translation | Do not do |
| D8 | Agent spend on the dashboard | Do later |
| D9 | Root chat on the local model | Do not do |
| P2.6 | Seal OAuth tokens at rest | Do later |
| P2.8 | Dead-code gate | Do now (safe rows only) |
| P4.6 | Webhook trigger | Remove the enum value |

## Facts that apply to more than one proposal

- Agents use MCP as their surface (`FOLLOWUPS.md:21-25`). The in-app chat serves the human only.
- Section 15 is out of date on one point. It lists email sync and calendar sync as out of scope (`docs/crm-plan.md:1360`).
  The schema now has `MailboxSync` (`packages/db/prisma/schema.prisma:1161`), `EmailMessage` (`:1207`) and `CalendarEvent` (`:1233`).
  The code already reverses section 15 for sync. This file treats section 15 as intent, not as fact.
- The schema has no model named Product, Quote, Invoice, LineItem or Payment. The author searched `packages/db/prisma/schema.prisma`.
- Custom fields exist for deals. `FieldEntity` has `DEAL` (`schema.prisma:995-999`). `FieldType` has `SELECT`, `NUMBER` and `URL` (`:1001-1012`).
  `FieldValue` links to a deal through `dealId` (`:1066-1067`). Saved views exist (`:1094-1110`).
  Several proposals use these to avoid a new table.

---

## D1. Product name strings

**Value.** No money earned or saved. Risk removed is small: the product name stops pointing at another company.

**What the string is, by group.**

| Group | Location | Action in the simplest version |
| --- | --- | --- |
| Browser title and description | `apps/app/app/layout.tsx:24-27` | Rename |
| Installed-app name | `apps/app/public/site.webmanifest:2-3` | Rename |
| Landing mock-up label | `apps/app/components/landing/product-shot/product-shot.tsx:64` | Rename |
| Agent identity | `apps/agent/agent/instructions.md:1,3` | Rename |
| Repo README | `README.md:17` | Rename |
| StartOS README | `deploy/startos/README.md:13` | Rename |
| StartOS store text, five languages | `deploy/startos/startos/manifest/i18n.ts:12,14,16,18,20` | Rename |
| Credit links to `trycomp.ai` | `apps/app/components/auth-shell.tsx:32-37`, `apps/app/components/landing/landing-footer.tsx:42-46` | Owner decides |
| Slack bot wording, 12 files | for example `apps/app/app/(app)/[slug]/settings/connections/slack/slack-channels.tsx` (12 lines) | Leave |
| Task reason text | `apps/api/src/agent/agent-trigger.service.ts:179` | Leave |
| Sample company named "Comp AI" | `packages/db/prisma/seed.ts:818`, `apps/app/components/landing/product-shot/companies.ts:19` | Leave |
| Logo label | `packages/ui/src/components/logo.tsx:10` | Protected, leave |
| Copyright line | `LICENSE:3` | Must stay |

The author searched the whole repo. Forty files contain "Comp AI", including tests and `LICENSE`.
The StartOS package title is already `CRM` (`deploy/startos/startos/manifest/index.ts:6`).
The default workspace name is already `CRM` (`packages/auth/src/organization.ts:6`).

**License.** `LICENSE:1-21` is the MIT license. Line 3 names "Comp AI" as the copyright holder.
Lines 11-12 require the copyright notice and permission notice in all copies or substantial portions.
The file has no clause about product names, logos or trademarks. A rename does not break the license.
Removing the visible credit links also does not break it. The license asks for the notice in copies, not for a credit in the UI.
The repo has no trademark policy. The author searched for the word "trademark". UNKNOWN: whether Comp AI claims a trademark.
This section is not legal advice.

**Cost.** About 14 lines in 8 files for the simplest version. One new name is needed. The owner has not chosen it.

**Migration.** No database change. The StartOS store text changes, so the package needs a new version and a release.

**Risk.**
- The Slack app name lives in the Slack app console. The repo has no Slack manifest. The author searched for `display_information` and found none.
  If the strings change and the Slack app keeps its name, the UI tells the user a wrong name.
- Two API tests assert the task reason text (`apps/api/test/agent-events.spec.ts:176`, `apps/api/test/agent-lifecycle.spec.ts:15`).
- Every renamed file conflicts with upstream when upstream edits the same line.
- The brand green `#006B4F` belongs to Comp (`adrs/comp-palette.md:5`). A rename leaves the palette unchanged.

**Simplest version.** Rename the seven "Rename" groups. Leave Slack wording, sample data, `LICENSE` and the logo.
Keep the copyright line. Choose the Slack app name first, then decide on the Slack strings.

**Recommendation: do later.** The rename earns no money. Do it with the first release that other people install.

---

## D2. Products, line items, quotes

**Value.** Money earned, only if the operator sends priced quotes from the CRM. A deal has one amount today.
The columns are `amount`, `currency` and `expectedCloseDate` (`schema.prisma:931-933`).
`SalesProposal` is not a price quote. It holds AI-extracted CRM operations: `contact_fact`, `create_note` and `create_task`
(`packages/validation/src/sales.ts:76-96`, `apps/api/src/sales/sales.service.ts:193-217`).
Section 15 lists Quotes and Products as out of scope (`docs/crm-plan.md:1362-1363`).

**Cost.** Three new models (Product, DealLineItem, Quote). A price list screen. A quote document renderer. Three or more MCP tools.
Each tool needs a test in the style of `apps/api/test/mcp-bridge.spec.ts`.

**Migration.** Additive. Old deals keep their `amount`. The owner must decide one rule: does `amount` equal the sum of line items, or stay manual?
`docs/currency.md` allows only `baseAmount` in totals. Line items must write `baseAmount` and `baseCurrency` in the same statement.

**Risk.** A second source of truth for the deal value. Tax and discount rules grow without end.
A wrong quote sent to a customer is a legal act. The CRM has no approval gate for it.

**Simplest version.** No new table. Add two custom deal fields: "Product" (`SELECT`) and "Quantity" (`NUMBER`).
Keep the price list in a document outside the CRM. The agent writes the line text into the deal description.

**Recommendation: do not do.** One operator and a few deals per month do not need a quote engine; custom fields cover the need.

---

## D3. Invoices and payments

**Value.** Money earned and risk removed: the operator sees "invoiced" and "paid" next to the deal.
Section 15 names Payments and Payment links as out of scope (`docs/crm-plan.md:1362-1363`). It does not name Invoices.
The schema has no invoice or payment model.

**StartOS option.** Use a payment service that the operator already runs. Do not build a ledger.
- BTCPay Server exists as a StartOS package. The only source readable here is indirect:
  the SDK changelog names "BTCPay" and "btcpayserver" as packages that use the SDK
  (`deploy/startos/node_modules/@start9labs/start-sdk/CHANGELOG.md:113,187`, installed by `npm ci`).
- UNKNOWN: whether the operator runs it, which version, and what its API accepts. The author cannot read BTCPay documentation here.
- UNKNOWN: how the CRM would authenticate to it.
- The CRM already declares one optional StartOS dependency: `ollama` (`deploy/startos/startos/manifest/index.ts:26-31`).
  The packaging guide shows how to read a dependency's address (`/home/user/ai-service-packaging/CLAUDE.md:172-173`).

**Cost.** Small for a link field. Medium for a status sync: one integration module, one secret, one inbound event path.

**Migration.** None for the link field. A status sync adds a column or a custom field and a backfill rule.

**Risk.**
- `Deal.amount` is `Decimal(14,2)` (`schema.prisma:931`). It cannot hold a bitcoin amount with eight decimals. Keep deal values in fiat.
- A payment event needs an inbound route. No such route exists (see P4.6). Without it the CRM must poll.
- The CRM would hold a payment-service key. Store it sealed (see P2.6).

**Simplest version.** Add a custom deal field of type `URL` named "Payment link". The operator or an agent pastes the BTCPay invoice link there.
The operator moves the deal to `CLOSED_WON` by hand (`schema.prisma:174-182`). No new code.

**Recommendation: do later.** Build the status sync only after the operator confirms BTCPay and after the P4.6 decision.

---

## D4. Sending email and sequences

**Value.** Money earned by faster follow-up. The cost is a new class of harm: an AI agent sends a wrong message to a real customer.

**Facts.**
- All mail scopes are read-only on purpose: `gmail.readonly`, `calendar.readonly`, `Mail.Read` (`packages/auth/src/scopes.ts:14-17`).
- `hasSyncScopes` requires every scope in the sync set (`scopes.ts:37-45`). A send scope added to `SYNC_SCOPES` breaks every existing connection.
  Send needs its own scope set and a separate reconnect.
- Sequences and cadences are out of scope (`docs/crm-plan.md:1360`).
- An `EMAIL` activity type exists (`schema.prisma:187`) and `EmailDirection` has `OUTBOUND` (`:1156-1159`). Both describe synced mail.
- The `log_activity` MCP tool exists (`apps/api/src/mcp/mcp-tools.ts:187`).
- Slack posting has no per-message approval. `AgentActionStatus` has no waiting state (`schema.prisma:253-259`).
  The human approves the agent version, not each post.

**The model to copy.** Sales proposals work in three steps. An API key files a request. An API key stores a proposal.
Only a human browser session approves it (`apps/api/src/sales/sales.service.ts:20-24,141-146`; `apps/api/src/sales/sales.auth.ts:20,35`).
The approval records the user and the session (`schema.prisma:1599-1600`). A unique idempotency key guards the apply step (`:1592`).
The approval checks that the session is still active (`sales.service.ts:146-157`).

**Cost.** Large. A draft model. Three MCP tools. A review screen. A send worker that uses the sender's own token.
Bounce and reply handling. A reconnect flow for the new scope. A quota. Tests that cannot reach real mail providers.

**Migration.** One new table. Existing mail connections stay valid only if send uses a separate scope set.
A user who wants send grants the new scope once.

**Risk.**
- Wrong recipient, wrong customer, repeated send. Each is irreversible.
- Domain reputation falls if an agent loops. A hard daily cap is required.
- API keys must never approve a draft. This rule already holds for sales proposals.

**Simplest version.** Drafts as notes. The agent calls `log_activity` and writes the proposed email as a note or task on the contact.
The operator copies it into the mail client. This needs no new scope and no new code.
The next step is an `EmailDraft` table with the sales approval pattern and a daily cap.
For sequences, use an agent schedule trigger that files drafts. Do not build a cadence engine.

**Recommendation: do later.** Use drafts as notes now; build send only when the operator's own agents cannot send mail by another route (UNKNOWN today).

---

## D5. Multiple pipelines

**Value.** Money earned only if the operator runs two sales motions with different stages. Section 15 calls one pipeline "the honest version"
(`docs/crm-plan.md:1363-1365`).

**Facts.** `DealStage` is a fixed enum with seven values (`schema.prisma:174-182`).
32 source files outside the generated client refer to a stage name or to `DealStage`. The author counted with a text search.
Stage names such as `DEMO_BOOKED` and `DECISION_MAKER_BOUGHT_IN` describe a software-demo motion.
UNKNOWN: whether these stages fit the operator's business.

**Cost.** Large. Replace the enum with `Pipeline` and `Stage` tables. Change a foreign key on `Deal` (`schema.prisma:919-960`).
Change the 32 files, the `deal.stage.changed` event, the `set_deal_stage` tool (`mcp-tools.ts:157`), saved views and the dashboard.

**Migration.** Create the tables. Copy the seven values as rows. Backfill every deal. Then drop the enum column.
A Postgres enum cannot lose a value (see P4.6), so the old column stays until a rebuild.

**Risk.** Totals and charts break if one stage is missed. Agents that call `set_deal_stage` with an old name fail.

**Simplest version.** Add a custom deal field "Motion" of type `SELECT`. Make one saved view for each value. No migration.

**Recommendation: do not do.** A solo operator separates motions with a field and a view; a second pipeline adds risk and no money.

---

## D6. Read-only role

**Value.** Risk removed, but only when a second human appears, for example an accountant. The operator is the only human today.

**Facts.**
- `docs/crm-plan.md` designs a `readonly` role (`:813`) built on the Better Auth `admin` plugin and `user.role` (`:783-787`).
  Phase 1 lists it (`:1272-1276`). The author found no such plugin call in `packages/auth/src/auth.ts`. The role is not built.
- The built roles are `owner`, `admin` and `member` (`packages/auth/src/organization.ts:8`).
  They gate settings only (`organization.ts:16-38`). In `apps/api` they appear in two services: `agent-access.service.ts:68,96` and `workspace.service.ts:92,181`.
- `AuthMiddleware` checks API-key scope. For a human session it checks only that a user exists (`apps/api/src/trpc/middlewares/auth.middleware.ts:34-50`).
  Every signed-in member can write.
- Sign-in is limited by the `ALLOWED_SIGN_IN` allow-list (`packages/auth/src/auth.ts:267-282`).
- Read-only access for AI clients already exists. The `agent_read` profile grants `crm: ["read"]` only (`apps/api/src/api-keys/api-key-profiles.ts:20`).
  The guard denies every mutation to such a key (`apps/api/src/trpc/api-key-access.ts:39`).

**Cost.** Small to medium. One new role value. One check in `AuthMiddleware` that rejects mutations for that role. Hide write buttons in the UI.
Tests for each router group.

**Migration.** None for existing rows if `member.role` is free text. UNKNOWN: whether any code limits the values of `member.role`.

**Risk.** A missed route lets a read-only user write. The UI hides buttons but does not enforce (`docs/crm-plan.md:824-826`).

**Simplest version.** Keep the allow-list narrow. Give a second human no account. Share data through a saved view export or an `agent_read` key.

**Recommendation: do later.** Build the role when a second human needs a login; the `agent_read` key already covers read-only agents.

---

## D7. Interface translation

**Value.** None for money. The author does not know the operator's language. UNKNOWN whether the operator needs another language.
Agents read English MCP tool text.

**Facts.**
- The app has no translation layer. The page language is fixed: `lang="en"` (`apps/app/app/layout.tsx:45`).
- `adrs/i18n.md` is a proposal from a contributor in Vietnam (`adrs/i18n.md:1-9`). It plans about ten pull requests.
  It adds a catalog, a continuous-integration check for hard-coded text, and a new column `user.locale`.
- `apps/app` and `packages/ui` hold 265 `.tsx` files. The author counted them.
- The StartOS package text is already translated into five languages (`deploy/startos/startos/manifest/i18n.ts:1-20`).
  That work serves the StartOS store, not the CRM interface.

**Cost.** Large. Ten pull requests. A permanent rule that every new string enters a catalog.

**Migration.** A `user.locale` column and a cookie. No data change.

**Risk.** The fork diverges from upstream on every file. Each upstream change to a string conflicts with the catalog work.

**Simplest version.** None. The agent can translate record text on request without a catalog.

**Recommendation: do not do.** The only human user reads the interface in the language it has; a catalog costs more than it returns.

---

## D8. Agent spend on the dashboard

**Value.** Money saved, but only for a metered provider. A Codex connection has two kinds: `CHATGPT` and `API_KEY` (`schema.prisma:1637-1640`).
Only `API_KEY` bills per token. The local model costs no per-token fee.
UNKNOWN: whether each provider reports `costUsd`. The field is nullable (`apps/agent/agent/hooks/audit.ts:15-17`).

**Facts, with one correction.**
- `AgentRun` stores `inputTokens`, `outputTokens` and `costUsd` (`schema.prisma:809-811`).
- `audit.ts:157-177` adds the usage of each step to those columns. It runs only for team-agent runs (`audit.ts:61-63`).
- The owner's note says root and research chat usage is only logged to the console. That is not complete.
  `activity.ts:131-147` prints it. But `audit.ts:43-56` also writes every event, except those ending in `.appended`, to `agentEvent`
  for all session purposes. The `step.completed` event carries `data.usage` (`audit.ts:11-21`).
  So chat usage is stored as raw JSON in `agentEvent.data`. Nothing adds it up.
  The author read the code. The author did not run an agent session to confirm it.
- A query over `agentEvent` JSON already exists as a pattern (`apps/api/src/telemetry/rollup.service.ts:233-241`).
- The dashboard summary has no spend figure (`apps/api/src/mcp/mcp-tools.ts:67-71`). The run list API returns `costUsd` for team-agent runs
  (`apps/api/src/agent/agent-runs.service.ts:53`).

**Cost.** Small. One aggregate query over `step.completed` events for the last 30 days. One card on the dashboard. One field in `dashboard.summary`.
The API is allowed to do plain arithmetic. The API must not hold intelligence (`AGENTS.md`).

**Migration.** None. Use `agentEvent` only. Using `agentRun` as well counts team-agent steps twice.

**Risk.** A null cost reads as zero. The card must say "cost not reported". Old events keep their JSON shape; a changed shape breaks the query silently.

**Simplest version.** One card: tokens and dollars in the last 30 days, grouped by model. Show "not reported" when `costUsd` is null.

**Recommendation: do later.** Build it after the operator connects an `API_KEY` credential; a flat plan or local model has no spend to see.

---

## D9. Root chat on the local model

**Value.** Privacy without a cloud model. No money effect. Agents do not use the in-app chat.

**Facts.**
- The root system input is about 5150 tokens: 27 tool definitions near 3750 plus a preamble near 1400 (`REVIEW.md:100-102`).
- The verified local profile is 4096 tokens (`apps/agent/agent/lib/inference/config.ts:5`).
- In `LOCAL` mode the root role is denied. `stepDecision` returns `deny` for any mode except `LEGACY_GATEWAY` (`apps/agent/agent/lib/inference/mode.ts:33`).
- A user with a Codex connection already gets the research chat. The root role binds the Codex connection at session start
  (`apps/agent/agent/lib/model.ts:132`; `docs/codex.md:45-47`).
- `FOLLOWUPS.md:71-80` lists the steps: measure a larger context, warm up the model, add a profile, lift the 4096 rule, enable the root role.

**Cost.** Medium. Hardware measurement on the operator's server. A new verified profile. A change in `parseLocalConfig` and in the StartOS action.
UNKNOWN: whether a small local model can use 27 tools well. No measurement exists.

**Migration.** A new profile value. Conversations bind their mode at start, so old conversations keep their route (`mode.ts:14-24`).

**Risk.** A model that cannot call tools well gives wrong answers in a chat that can change records.

**Simplest version.** Use a Codex connection for chat. Leave local mode for sales extraction.

**Recommendation: do not do.** Codex already serves the one human user, and a 4096-token window cannot hold the root prompt.

---

## P2.6. Seal OAuth tokens at rest (not implemented in this round)

**Why not implemented.** The change touches every reader of a token. The CRM cannot test the Gmail, Outlook and Slack read paths against real providers in CI.
A silent break would stop mail sync and Slack posting.

**What the library does.** `better-auth` 1.6.25 supports `account: { encryptOAuthTokens: true }`.
`setTokenUtil` encrypts a token with the auth secret on write (`node_modules/.bun/better-auth@1.6.25+6f7f63a766f3d984/node_modules/better-auth/dist/oauth2/utils.mjs:21-27`).
`decryptOAuthToken` decrypts on read. It returns a value unchanged when `isLikelyEncrypted` is false (`utils.mjs:6-20`).
`isLikelyEncrypted` is true for a `$ba$` prefix or for any even-length hex string (`utils.mjs:6-9`).
The three installed copies of this file are identical. The cipher is XChaCha20-Poly1305 from `@noble/ciphers` (`dist/crypto/index.mjs:7,30-40`).
The option covers `accessToken` and `refreshToken` only. `idToken` stays plain (`dist/api/routes/callback.mjs:107-109`; `dist/oauth2/link-account.mjs:35-37`).
The Slack provider writes through the same utility (`dist/plugins/generic-oauth/routes.mjs:243-259`).
The current auth config has an `account` block at `packages/auth/src/auth.ts:88-93`. The option goes there.

**Who reads token values directly.** The author searched `apps` and `packages` for `accessToken`, `refreshToken`, `userToken` and `contextDevApiKey`.

| Reader | Location | Needs the shared module |
| --- | --- | --- |
| Slack bot token | `apps/agent/agent/lib/slack-connection.ts:4-10` | Yes |
| Slack user token | `apps/agent/agent/lib/slack-connection.ts:19-23` | Yes (after column change) |
| Google revoke on disconnect | `apps/api/src/mailbox/mailbox-token.service.ts:141-148` | Yes |
| Context.dev key read | `packages/db/src/settings.ts:59-66`; users `apps/agent/agent/lib/capabilities.ts:22`, `apps/api/src/settings/settings.service.ts:89` | Yes (after column change) |
| Context.dev key write | `packages/db/src/settings.ts:68-75` | Yes (writer) |
| Slack install writer | `packages/auth/src/slack-grant.ts:14,52-57` | Yes (writer) |

Readers that need no change:
- Gmail, Calendar and Outlook sync call `auth.api.getAccessToken` (`mailbox-token.service.ts:84`). Better Auth decrypts inside that call.
- Presence checks read no token value: `slack-people.ts:178-186` (raw SQL, `IS NOT NULL`), `builder-runtime.ts:631-634`,
  `conversations.service.ts:203-207`, `slack-connection.service.ts:47-50,166-170`, `mailbox-token.service.ts:62-67`.
  An encrypted value is still not null.
- `rollup.service.ts:143,152` tests only that the Context.dev key is non-empty.
- The Codex credentials are already sealed with `CRM_SECRETS_KEY` (`apps/agent/agent/lib/codex/seal.ts:21-35`). They need no change.

**Columns that change.**
- `account.accessToken` and `account.refreshToken` (`schema.prisma:138-139`). Better Auth writes them.
- `slackInstallation.userToken` (`schema.prisma:95`) and `slackWorkspaceGrant.userToken` (`:106`). The CRM writes them.
- `appSetting.contextDevApiKey` (`:1309`). The CRM writes it.
- All columns are `TEXT`. No type change. `account.idToken` (`:140`) stays plain. Report it as NOT DONE.

**Where the shared code lives.** One small module in `packages/auth`, exported as `@crm/auth/token-seal`.
It wraps `symmetricEncrypt` and `symmetricDecrypt` from `better-auth/crypto` (exported in the package manifest of `better-auth`).
It reads `BETTER_AUTH_SECRET`, the same key the auth config uses.
Two constraints decide the place:
- `@crm/auth` depends on `@crm/db` (`packages/auth/package.json:23`). `@crm/db` cannot import `@crm/auth`. So `packages/db/src/settings.ts` stays plain.
  The callers seal and open the Context.dev key.
- `apps/agent` does not depend on `@crm/auth` or `better-auth` today (`apps/agent/package.json:25-28`).
  Adding `@crm/auth/token-seal` adds a dependency. The agent already receives `BETTER_AUTH_SECRET`: `turbo.json:10` passes it through,
  and StartOS puts it in the one container environment (`deploy/startos/startos/main.ts:108`).
- The module must use the same key shape as Better Auth. If `BETTER_AUTH_SECRETS` is set, Better Auth writes a versioned `$ba$` envelope
  (`dist/context/create-context.mjs:72-80`; `dist/crypto/index.mjs:14-57`). The module must read both forms.

Why not reuse `CRM_SECRETS_KEY`: it is optional (`.env.example:180`) and a missing key turns the feature off.
`BETTER_AUTH_SECRET` is required (`apps/api/src/config/env.validation.ts:40-42`).

**Migration.** A one-off, idempotent script in `apps/api/scripts/` (the folder already holds `local-account.ts`).
1. Take a backup first (`deploy/startos/startos/backups.ts:6-19` does a `pg_dump`).
2. For each row and column, try to decrypt. If decrypt succeeds, the value is already sealed: skip it.
   If it throws or the value is not marked, the value is plain: encrypt it and write it in the same row transaction.
   Do not trust `isLikelyEncrypted` alone, because a plain token that is even-length hex would match it.
3. Run under `lockIdempotencyKey` (`packages/db/src/idempotency.ts`, used at `slack-grant.ts:2,33`) so two runs never overlap.
4. Support `--dry-run`. Print counts only, never token values.
5. Turn on `encryptOAuthTokens` and ship the readers in the same release. New writes then arrive sealed. Old plain values pass through.

**Rollback.** The same script with a `--decrypt` mode. Run it before turning the option off.
With the option off, Better Auth sends stored text as is (`utils.mjs:19`). A sealed value would reach Google as junk.
Keep `BETTER_AUTH_SECRET` unchanged across the whole change. Restore from the backup if the script fails half-way.

**Risk.**
- Rotating `BETTER_AUTH_SECRET` signs everyone out today (`SECURITY.md:48-50`). After sealing it also makes every stored token unreadable.
  Every provider needs a reconnect. `SECURITY.md` needs a new sentence.
- On StartOS the key does not protect a stolen backup. `store.json` holds the key (`deploy/startos/startos/fileModels/store.json.ts:42,55`)
  and the backup copies the `main` volume (`backups.ts:19` excludes only `postgresql`). Sealing protects against a database-only leak.
  UNKNOWN: whether StartOS encrypts its own backup files. The author cannot read that here.
- The sole operator can still sign in with a password when OAuth fails (`deploy/startos/startos/main.ts:109`).
- CI cannot call real Gmail, Outlook or Slack. Tests cover the seal round trip, plain pass-through, migration idempotency on a test database,
  and `getAccessToken` with a stubbed provider. A live check on StartOS stays manual: sync one Gmail account, one Outlook account, post one Slack message.

**Recommendation: do later.** The key and the sealed data travel in the same backup, so the gain is narrow; do it before the CRM holds more than one operator's mailbox.

---

## P2.8. Dead-code gate (not implemented in this round)

**State.** `bun run lint:dead` runs knip (`package.json:12`). It is not in CI (`FOLLOWUPS.md:100-103`) and it exits with code 1.
The author ran it on this branch. The output is identical to the saved baseline.

**Count.** The baseline file lists 94 findings and 8 hints. The owner's figure of 92 leaves out the two unused development dependencies.

| Kind | Count |
| --- | --- |
| Unused dependencies | 4 |
| Unused development dependencies | 2 |
| Unlisted dependencies | 2 |
| Unresolved imports | 1 |
| Unused exports | 40 |
| Unused exported types | 44 |
| Duplicate exports | 1 |
| Configuration hints | 8 |

**Rule for the table.** Class "Safe" means the change is local and the type check proves it. Class "Care" means a tool, a build or a generator reads the name.
Class "Keep" means the finding is wrong and the owner must not delete.

### Dependencies and config

| File | Findings | Class | Reason |
| --- | --- | --- | --- |
| `packages/db/package.json:50` | `@prisma/client` | Keep | The generated client imports `@prisma/client/runtime/client` (`packages/db/src/generated/prisma/client.ts:18`). Knip skips generated files. |
| `apps/api/package.json:29` | `@crm/env` | Care | No import in `apps/api`. Removal changes `bun.lock` and the workspace graph. Run `bun install` and the build. |
| `apps/api/package.json:42` | `@vercel/blob` | Care | Only `packages/db/src/blob.ts` imports it, and `packages/db/package.json:51` lists it. Removal changes `bun.lock`. |
| `apps/api/package.json:47` | `context.dev` | Care | Only `apps/agent` imports it (`apps/agent/package.json:29`). Removal changes `bun.lock`. |
| `apps/app/package.json:42,48` | `@tailwindcss/postcss`, `tailwindcss` | Keep | `packages/ui/src/styles/globals.css:1` imports `tailwindcss`, and the app config re-exports the UI PostCSS config. Knip does not follow `.css`. |
| `apps/app/lib/trpc/hydrate.tsx:1`, `apps/app/lib/trpc/server.ts:1` | `server-only` unlisted | Safe (config) | Next.js aliases `server-only` itself (`next/dist/build/create-compiler-aliases.js:220-228`). Add it to knip `ignoreDependencies`. Do not install it. |
| `packages/typescript-config/nextjs.json` | `next` unresolved | Safe (config) | The value is a TypeScript plugin name (`"plugins": [{ "name": "next" }]`), not an import. |
| `knip.json` | 8 hints | Safe (config) | Edit `knip.json` only. Run knip again; the finding count must not rise. |

The eight hints are: three `ignore` patterns to remove (`**/.eve/**`, `**/.scratch/**`, `**/generated/**`), two unmatched patterns in
`packages/typescript-config`, and `.css` and `.prisma` extension notes for `apps/app`, `packages/ui` and `packages/db`.
Removing `**/generated/**` is the one hint with a possible side effect. Run knip after each edit.

### Unused exports and types, grouped by file

Fix for "Safe": delete the `export` keyword, or delete the line if nothing in the file uses it. The type check proves the result.
For a contracts file, run `bun run --filter=api trpc:generate` and require an empty diff in `apps/api/src/generated/server.ts`.

| File | Names (line) | Class | Note |
| --- | --- | --- | --- |
| `apps/api/src/api-keys/api-keys.contracts.ts` | `apiKeySummaryOutput` (23) | Safe | |
| `apps/api/src/companies/companies.contracts.ts` | `companyRowOutput` (116) | Safe | |
| `apps/api/src/contacts/contacts.contracts.ts` | `contactRowOutput` (133) | Safe | |
| `apps/api/src/conversations/conversations.contracts.ts` | `builderResource` (84), `builderAttachment` (92), `conversationSummaryOutput` (232), `builderConversationSummaryOutput` (252), `builderResourceOutput` (272), `agentBuilderArtifactOutput` (282), `conversationEventOutput` (371) | Safe | 7 names |
| `apps/api/src/crm/bulk.ts` | `MAX_BULK_IDS` (5) | Safe | Used in the file |
| `apps/api/src/crm/enrichment-log.service.ts` | `describeFilled` (70) | Care | A function. Check it is used in the file, else delete it. |
| `apps/api/src/currency/currency.contracts.ts` | `currencyRateOutput` (37), `currencyInUseOutput` (47), `unconvertedOutput` (54), `currencyMetaOutput` (59); types `SetReportingCurrencyInput` (15), `SetManualRateInput` (27), `RemoveManualRateInput` (33), `CurrencyInUse` (76) | Safe | 8 names |
| `apps/api/src/currency/rates.service.ts` | `RATES_PROVIDER` (17) | Safe | |
| `apps/api/src/deals/deals.contracts.ts` | `MAX_AMOUNT_CENTS` (9); types `DealListResult` (225), `DealDetail` (250), `DealCreated` (258), `DealMutated` (265), `DealSetStageResult` (273), `DealContactOption` (277), `DealContactLink` (284), `DealContactRoleResult` (292), `DealBulkResult` (301) | Care | `docs/currency.md` names `MAX_AMOUNT_CENTS`. Used in the file at line 15. Keep the name; un-export only. |
| `apps/api/src/google/gmail.client.ts` | `WORK_MAIL_QUERY` (40) | Safe | Used at line 64 |
| `apps/api/src/google/google.constants.ts` | `CALENDAR_SCOPE` (2), `GMAIL_SCOPE` (3), `SYNC_SCOPES` (8) | Safe | Re-exports of `mailbox.constants` |
| `apps/api/src/google/google.contracts.ts` | `googleSourceStatusOutput` (31); types `SetAutoCreateInput` (24), `SuppressDomainInput` (25), `EmailThreadOutput` (154), `CalendarEventOutput` (155) | Safe | |
| `apps/api/src/mailbox/mailbox.constants.ts` | `CALENDAR_SCOPE` (11), `GMAIL_SCOPE` (12), `MICROSOFT_SYNC_SCOPES` (16), `SYNC_SOURCES` (21) | Safe | Re-exports of `@crm/auth` (`scopes.ts:14-20`) |
| `apps/api/src/microsoft/microsoft.constants.ts` | `MICROSOFT_SYNC_SCOPES` (3), `OUTLOOK_MAIL_SCOPE` (6) | Safe | Re-exports |
| `apps/api/src/microsoft/microsoft.contracts.ts` | `microsoftSourceStatusOutput` (18); type `SetOutlookAutoCreateInput` (10) | Safe | |
| `apps/api/src/saved-views/saved-views.contracts.ts` | `savedViewEntity` (5); type `SavedViewListInput` (11) | Safe | |
| `apps/api/src/settings/settings.contracts.ts` | `catalogModelOutput` (7); types `CatalogModel` (15), `SetAgentModelInput` (51), `SetResearchKeyInput` (65), `SetArchiveRetentionDaysInput` (81) | Safe | |
| `apps/api/src/telemetry/seed.ts` | `SEED_DEAL_PREFIX` (3) | Care | Seed data helper. Check scripts and `docs/telemetry.md` before removal. |
| `apps/api/src/tracking/tracking.contracts.ts` | `sourceRowOutput` (102) | Safe | |
| `apps/api/src/trpc/list-input.ts` | `FACET_ALL` (67), `ACTIVITY_WINDOWS` (94); types `SortDirection` (35), `ActivityWindow` (96) | Safe | |
| `apps/api/src/agent/agents.contracts.ts` | types `AgentListItem` (162), `AgentDetail` (249), `AgentRunSummary` (302), `AgentAuditEventSummary` (320) | Safe | |
| `apps/api/src/enrichment/enrichment.service.ts` | types `EnrichmentQueueSubject` (12), `EnrichmentQueueRow` (29), `EnrichmentScheduledRow` (37) | Safe | |
| `apps/api/src/fields/fields.contracts.ts` | type `FieldListInput` (11) | Safe | |
| `apps/api/src/mailbox/mailbox-match.service.ts` | type `SyncRecordSource` (18) | Safe | |
| `apps/api/src/mailbox/mailbox-token.service.ts` | type `TokenFailure` (17) | Safe | |
| `apps/api/src/slack/slack.contracts.ts` | type `SlackCreateChannelReply` (40) | Safe | |
| `apps/api/src/tracking/tracking-ingest.service.ts` | type `FormFields` (41) | Safe | |
| `apps/app/components/crm/inline-field.tsx` | `savingField` (30) | Care | A function. Check use in the file. |
| `apps/app/lib/agent-transcript.ts` | `toolName` (287) | Care | A function. A test file imports transcript helpers; check. |
| `apps/app/lib/analytics.ts` | `ANALYTICS_HOSTS` (1) | Safe | Used at line 7 |
| `apps/app/components/agent-builder/agent-composer.tsx` | types `BuilderResource` (54), `BuilderUploadAttachment` (56), `BuilderStoredAttachment` (61), `BuilderAttachment` (66) | Safe | |
| `apps/app/components/crm/section-prefetch.ts` | type `Section` (10) | Safe | |
| `apps/app/lib/agent-record.ts` | type `CarbonIcon` (80) | Safe | |
| `tools/oxlint/anti-slop/shared/dictionary-types.ts` | `isPopulatedObjectExpression` (413); type `WideningTargetKind` (27) | Care | Lint rule tooling. The author found no importer in `tools/`. Run `bun run lint:slop` after the change. |
| `apps/api/src/activities/activities.contracts.ts` | duplicate: `activityEntryOutput`, `activityCreateOutput` (182), `completeOutput` (184) | Care | The router imports both aliases (`activities.router.ts:16,18,81,93`). Both names appear in the generated `server.ts`. Keep, or add to knip ignore. |

**Plan if approved.**
1. Apply the config rows first (3 files). Run knip. The count must stay at or below 94.
2. Approve the "Safe" file rows. Apply them in one commit per workspace (`apps/api`, `apps/app`). Run `check-types`, `lint`, `lint:slop` and `trpc:generate`.
3. Handle the "Care" rows one by one.
4. Never delete the two "Keep" rows.
5. When knip exits with code 0, add `bun run lint:dead` to `.github/workflows/ci.yml`.

**Recommendation: do now for the config rows and the Safe rows.** The edits remove noise without a behaviour change; the gate then protects later work.

---

## P4.6. Webhook trigger (not implemented in this round)

**State.** `AgentTriggerType` has four values: `MANUAL`, `SCHEDULE`, `EVENT`, `WEBHOOK` (`schema.prisma:237-242`).
The manifest schema accepts only the first three (`packages/validation/src/agent-manifest.ts:58-77`).
The builder draft type also excludes `WEBHOOK` (`apps/agent/agent/lib/builder-runtime.ts:38`).
The code that creates runs writes `MANUAL` (`apps/api/src/agent/agent-runs.service.ts:211`), `SCHEDULE` and `EVENT`
(`apps/agent/agent/lib/custom-agent-dispatch.ts:281,363`). No code creates a `WEBHOOK` row.
No inbound route exists for it. The public ingest routes are tracking (`apps/api/src/tracking/tracking.controller.ts:63,91`) and internal cron routes.
Two more places name the value: `apps/api/src/agent/agents.contracts.ts:51` and `apps/agent/agent/lib/dispatch-config.ts:28`.

**Option A. Build it.**
- Value: an outside service, such as a payment server, starts an agent run. Agents that call MCP do not need it.
- Cost: medium. A public route under `/api/` (the web origin exposes `/api/mcp` and `/api/trpc/*`; the API port stays closed, `FOLLOWUPS.md:23-24`).
  A secret per trigger and a signature check. A body size limit. A rate limit. An idempotency key. A new variant in `agent-manifest.ts`.
  A builder change. A UI field. Tests.
- Risk: a new unauthenticated surface on the operator's server. A leaked URL starts paid model runs.
- Migration: none. The enum value already exists.

**Option B. Remove the unused value.**
- Value: the contracts stop offering a trigger that does not work. No money effect.
- Cost: small code, careful migration.
- Migration: Postgres cannot drop an enum value. The author ran `ALTER TYPE ... DROP VALUE` on PostgreSQL 16.15 and it failed with a syntax error.
  The StartOS package uses `postgres:17.11-alpine` (`deploy/startos/startos/manifest/index.ts:24`). The author did not test version 17.
  The migration must create a new type. Then it converts two columns with a cast. Then it drops the old type and renames the new one.
  The two columns are `agentTrigger.type` and `agentRun.triggerType`
  (`packages/db/prisma/migrations/20260803210000_agent_builder_foundation/migration.sql:67,86`).
  The migration must first count rows with `WEBHOOK` and stop if the count is above zero.
  The local test database holds zero such rows. UNKNOWN: the count on the operator's server. No code path writes one.
- Risk: a failed cast locks two tables during the change. The tables are small on a solo server. Take a backup first.

**Option C. Leave it.** The unused value costs nothing at runtime. It misleads the reader of `agents.contracts.ts:51`.

**Link to D3.** BTCPay would send webhooks. If the owner chooses D3 with a status sync, Option A becomes the route.
Without D3, no sender exists for it.

**Recommendation: remove the value (Option B), and do it with the next migration that touches these tables.**
The solo operator has no webhook sender today, and a public inbound route adds risk without money.
Rebuild the route when D3 needs it.

---

## Issues

1. UNKNOWN — Whether Comp AI claims a trademark on the name. The repo has no policy.
   Fix: not done. The owner must ask the upstream maintainers before a public release.
2. UNKNOWN — Whether the operator runs BTCPay Server, and what its API accepts. The author cannot read its documentation here.
   Fix: not done. Read the BTCPay docs on the operator's server before D3.
3. UNKNOWN — Whether StartOS encrypts its backup files. The key and sealed tokens would travel together.
   Fix: not done. Read the StartOS backup documentation before P2.6.
4. UNKNOWN — Whether each model provider reports `costUsd`. The column is nullable.
   Fix: not done. Run one session per provider and read `agentEvent` before D8.
5. UNKNOWN — Whether the stages in `DealStage` fit the operator's business.
   Fix: not done. The owner must say how many sales motions exist before D5.
6. UNKNOWN — Whether any rows with `WEBHOOK` exist on the operator's server. No code writes one.
   Fix: not done. The P4.6 migration counts them before it changes the type.
7. RISK — `docs/crm-plan.md:1360` says email and calendar sync are out of scope. The code has both.
   Fix: not done. Update section 15 or mark it as superseded.
8. RISK — The owner's brief says 92 knip findings. The baseline holds 94 findings and 8 hints.
   Fix: this file uses the baseline counts. The two extra findings are the unused development dependencies.
9. RISK — The owner's brief says chat usage is not stored. `audit.ts:43-56` stores it in `agentEvent`. No code adds it up.
   Fix: D8 uses the corrected fact. The author read the code and did not run a session.
10. RISK — The BTCPay evidence is a changelog line in `node_modules`. That path exists only after `npm ci` in `deploy/startos`.
    Fix: not done. Replace it with a link to BTCPay package documentation when the owner has one.
11. NOT DONE — `account.idToken` stays plain after P2.6.
    Fix: not done. Decide in P2.6 whether to blank it after sign-in.
12. NOT DONE — The line counts and file counts in D1, D5 and D7 come from text searches. They are not exact for generated files.
    Fix: not done. Recount when the owner approves a proposal.
