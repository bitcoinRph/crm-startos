# API Rules

## Logging

`apps/api/src/logging`. `new Logger(Thing.name)` picks up `ContextLogger`. **Never
`console.log`.** Format follows `NODE_ENV` and is not configurable.

- **One object, not extra arguments** — `logger.log({ message: "Saved", userId })`;
  Nest prints a line per argument.
- **Errors pass the stack second** — `logger.error({ message }, err.stack)`. Passing
  the error object drops the trace.
- **Never log headers, query strings, or bodies** — cookies and personal data.
- **`LoggingModule` stays first in `AppModule`'s imports**, and Better Auth routes log
  via its own `middleware` option — it mounts before `MiddlewareConsumer`, so
  `/api/auth/*` never reaches ours.
- `requestId` from `RequestLoggerMiddleware` via `AsyncLocalStorage`;
  `UserContextInterceptor` adds `userId`. Prisma statements are opt-in
  (`PRISMA_LOG_QUERIES`).

## Intelligence never lives in the API

The API serves HTTP, auth, tRPC and the mailbox sync. It does **not** research, enrich,
score, summarise, match identities or decide anything about a person or company — not
as a fallback, not behind a flag. That is the eve agent in `apps/agent`, which owns
the vendor clients, the confidence model and the writes.

Nest's half is to report *that something happened*: `AgentTriggerService` writes an
`AgentTask` row. A row, not an HTTP call — the agent already leases from that table,
so the row survives the agent being down.

About to add a vendor client to `apps/api`? You want `apps/agent/agent/lib`. One
documented exception, for timing: the exchange-rate fetcher, below.

When a settings screen needs a vendor answer now, the API asks the agent over the
bridge and relays the parsed answer: `POST /internal/crm/verify-key` for Context,
`POST /internal/crm/codex/*` for Codex sign-in (`docs/codex.md`). The API holds no
vendor client and no vendor credential for either.

## One organization, and it is not a tenancy boundary

Single tenant. No org header, no org interceptor, no org-scoped cache keys, **no
`organizationId` on any CRM record.**

A **singleton workspace** exists — Better Auth's `organization` plugin, one row with
id `WORKSPACE_ID` (the literal `workspace`, in `@crm/db`, re-exported by `@crm/auth`
so the agent needn't depend on it). It answers only: what are we called, who works
here, what do we sell.

- **The id is a constant, never a parameter.** A function taking an `organizationId`
  has turned the plugin into tenancy plumbing.
- **Signing in is the join; no invite flow.** `ensureWorkspaceMembership` runs in
  `databaseHooks.session.create.before` and **degrades, never throws** — a throw fails
  the session create and locks everyone out. The plugin's `invitation` table is unused.
- **First account is owner**, and the hook enrols pre-existing users, oldest first.
- **Permissions come from `@crm/auth`** — `canRenameWorkspace`, `canChangeRole`,
  `canConfigureSso`, `canManageCurrency` — enforced by the service *and* used to
  disable the UI control, so the button and the 403 cannot disagree.
  `WorkspaceService` adds one invariant: **the last owner cannot be demoted**, with
  `FOR UPDATE` on the owner rows before counting.
- **Reads and writes go through tRPC**, not `authClient.organization.*`.
- **Name and website are required at onboarding and cannot be skipped**, in the form
  *and* in `updateWorkspaceInput`, posting the same `workspace.update` as settings.
- **Onboarded state is `onboardedAt` inside the plugin's `metadata` blob**, not a
  column; `isOnboarded`/`markOnboarded` (`@crm/db/workspace`) are the only accessors,
  and `markOnboarded` preserves every other key.
- **The name starts as `DEFAULT_WORKSPACE_NAME` (`CRM`), a placeholder not an
  answer.** The header renders `<name> CRM`, so `workspaceLabel` tests the name rather
  than comparing to the default.
- **The website queues the agent's `workspace-profile` task** and goes through
  `normalizeDomain`, rejecting null. Stored canonical, so re-saving uncanonically
  counts as a change and re-queues research.

### Gates in `proxy.ts`

Workspace onboarding runs before ordinary CRM navigation. Context research remains optional.

- **`getSessionCookie()` decides signed-in**; pages still resolve the real session via
  `requireMailboxAccess()`.
- **Nothing is cached in a cookie** — both facts revert on a database reset while a
  year-long marker insists the gate passed. Cache in the API if cost ever matters.
- The proxy reads workspace onboarding only. It does not query research-key status.
- **An unreachable API fails open** (`unknown` lets the request through).
- **`/sign-in`, `/grant-access`, `/eve` are ungated.** `/sign-in` is the only path a
  stranger may read; `/` joins it only when `IS_MARKETING` is set.
- The retired research onboarding route redirects to the CRM. Configure optional research from Settings.

### The name is also the URL

Served under the workspace slug (`/comp-ai/companies`). **Cosmetic, not tenancy** —
every query still resolves through `WORKSPACE_ID`.

- **The slug is the plugin's column**, written by `workspaceSlug(name)`
  (`@crm/db/workspace`) on rename and create. **Never derive it on read.**
- `ensureWorkspaceMembership` reconciles it; `RESERVED_SLUGS` prevents collision with
  a real route (a collision gets `-crm`).
- **The proxy is the only thing that puts the slug on.** Missing or stale slugs are
  redirected with the query string intact, not 404'd; `[slug]/layout.tsx` is the
  backstop.
- `appPath` in `proxy.ts` is the one place `/` resolves for a signed-in rep, which
  keeps every `callbackURL` correct without knowing about slugs.
- **Renaming moves the URL**, so `workspace-form.tsx` replaces the location onto the
  slug `workspace.update` returns.

## SSO is a row, not a deployment

An `ssoProvider` row via Better Auth's `sso` plugin, on Settings → SSO, because a
self-hoster's admin cannot redeploy.

- **OpenID Connect only** — issuer, client id, secret; endpoints from discovery. No
  SAML UI: it needs an X.509 cert and SP signing key we have nowhere to keep.
- `SsoService` passes `WORKSPACE_ID`, never an input.
- **Management is tRPC (`sso.*`); signing in is `authClient.signIn.sso()`.**
- **`sso.signInOptions` is the one public procedure in the app.** Every other `sso.*`
  takes `AuthMiddleware` at the *method*, which is what leaves it open. A client
  secret is never read back out.
- **It is the API's answer, not the app's** — the API serves `/api/auth/*`.
- **An install with no Google, no Microsoft and no provider says so**, naming the
  variables; a read that *fails* falls back to offering Google.
- **A provider hides the social buttons, it does not disable them** —
  `/sign-in?method=google` and `?method=microsoft` still work, so a mistyped issuer
  cannot lock an admin out.
- **Signing in with an IdP does not cost you Gmail.** `needsMailboxGrant` (`@crm/auth`)
  walls only an account whose sign-in rows are *all* mailbox providers — Google,
  Microsoft, or both — and none of them granted. `mailboxGrantsNeeded` returns which,
  so `/grant-access` offers the button they can actually use.
- `ALLOWED_SIGN_IN` still decides who gets an account, in
  `databaseHooks.user.create.before`, for SSO sign-ups too.
- `organizationProvisioning: { disabled: true }` — `ensureWorkspaceMembership` already
  does the join.

## tRPC is the data surface; REST is auth and health only

- **One router per module**, `*.router.ts` (the codegen glob), with
  `@Router({ alias })` and `@UseMiddlewares(AuthMiddleware)`. **No `AuthMiddleware`
  means public — there is no other guard.**
- **Routers are thin**: zod in, service call out; Prisma lives in `*.service.ts`.
- Services throw Nest's `HttpException` family; `DomainErrorMiddleware` maps them.
- **Filter, sort and paginate in Prisma.** List procedures take `listInput` and return
  `{ rows, total, facetCounts }`. Never filter a whole table in the browser; never
  interpolate `sort` into a field name — use `resolveOrderBy`.
- **`src/generated/server.ts` is generated *and committed*, and `build` must never
  regenerate it** — the generator needs GLIBC 2.39, newer than Vercel's build image.
  Only `check-types` and `dev` run it. If the app cannot see a new procedure, it has
  not run.

## The OpenAPI document is built at runtime, not committed

`GET /openapi.json` serves one document: Nest's own controllers plus a REST bridge
under `/rest` generated from every tRPC procedure. Every bridge path in the
document carries the `/rest` prefix, so a client resolves it against the
document's own origin. Swagger UI renders it at `/`.

The web app proxies `/openapi.json` and `/rest/*` to the API with the same
handler as `/api/*` (`apps/app/lib/api-proxy.ts`), and `proxy.ts` lets both
through without a session, because the API authenticates every `/rest` call.
On StartOS, where only the web origin is exposed, this is the REST surface.
The proxy forwards only `/api`, `/rest` and `/openapi.json`
(`PROXIED_PATHS` in `apps/app/lib/api-proxy-request.ts`), and the web
`/openapi.json` route keeps only those paths, so every path a client reads there
is reachable there. Nest's root controllers (`/health`, `/auth/*`, `/internal/*`)
stay in the API's own document only.

trpc-to-openapi routes a request to the first path pattern that matches, in
procedure order. `restBridgeRouter` in `apps/api/src/trpc/openapi.ts` sorts the
procedures so a static segment is tried before a `{parameter}` at the same
position: `/sales/requests/review-queue` before `/sales/requests/{requestId}`.
Declare REST paths in any order; the mcp-bridge spec checks that every path
reaches its own procedure.
`createApp` builds both halves and merges them, so nothing is generated at build
time and no file is checked in — the document is whatever the routers are.

`SwaggerModule.setup` runs **before** `app.init()`, because it registers its Express
routes synchronously and Nest's own routing would otherwise shadow them. The factory
form defers building the document to the first request, which is what lets it read
the tRPC router that only exists after init.

Two rules follow for the serverless build:

- `@nestjs/swagger` stays in `EXTERNALS` in `apps/api/scripts/build-func.mjs`, because
  `swagger-ui-dist` resolves its assets from disk at runtime and cannot be bundled.
- Anything external must be **vendored**, and vendoring follows non-optional
  `peerDependencies`, not only `dependencies`. Nest packages declare their runtime
  needs as peers, so following `dependencies` alone ships a function that throws
  `MODULE_NOT_FOUND` on the first request. Adding a name to `EXTERNALS` without
  checking it lands in `.vercel/output` breaks production, and the build stays green.

## The MCP endpoint is built at runtime from tRPC, like the OpenAPI document

`POST /api/mcp` is a [Model Context Protocol](https://modelcontextprotocol.io)
server in `src/mcp/`. It exists so an outside agent — Claude Code, Codex,
Hermes — can read and write the CRM through the same procedures, validation and
middlewares as the app. It is a wire format, not a second data surface.

- **Every tool is a tRPC procedure.** `mcp-tools.ts` is the allow-list: a tool
  name, the procedure path and a description written for a model. Its input
  schema is the procedure's own zod input, converted with `z.toJSONSchema`, so
  a contract change reaches the tools without a second copy.
- **Nothing here decides anything.** A tool call is `callProcedure` with the
  request's context, so `AuthMiddleware` and the services run exactly as they
  do for the browser. Rule one holds: the agent that calls the tools is the one
  doing the thinking.
- **An API key is the credential.** The bridge resolves the session the way
  `createBaseTrpcContext` does, and additionally accepts the key as
  `Authorization: Bearer crm_…` because some MCP clients can only send that
  header. A POST without a key or session returns `401` before any JSON-RPC is parsed.
  The bridge discards rejected POST bytes without parsing them before completing the response.
  An aborted upload closes its response.
- **Stateless, JSON responses.** One `Server` per request, no session ids, no
  SSE, so the endpoint works through the app's `/api/*` proxy and through
  reverse proxies that buffer. GET and DELETE return `405` with `Allow: POST` before authentication.
  The endpoint offers no GET notification stream or resumable session.
- **Not every procedure belongs in the list.** Bulk operations, purges, API-key
  management, SSO and tracking settings stay out. Adding a tool is one entry in
  `mcp-tools.ts`; adding a destructive one is a review question.
- **Tool discovery follows enforcement.** `tools/list` filters by the key's stored permissions.
  Sales tools also require every scope that their router enforces.
  A cookie session sees the full allow-list. `tools/call` still checks every call.
  A valid key takes precedence over a different user's cookie through Better Auth's existing key-session contract.
  Discovery and calls use that key's owner and permissions. No new mismatch rule changes this contract.
- **`search_crm` returns active records only.** Companies match name or domain; contacts match name or email; deals match name.
  Each kind returns at most five substring matches. The same filter applies to quick search (⌘K).
  Use the Archived view for archived records. The filter checks each row, without a parent cascade.
- **`resolve_customer` is exact lookup, not identity inference.** Pass exactly one email or domain.
  Use `search_crm` for names. Existing `get_*` tools cover record IDs.
  Emails use `normalizeEmail` and parameterized `lower(email) = value` equality. Wildcards remain literal characters.
  No plus-tag or dot stripping occurs. Lookup retains strict Zod email validation.
  Nonstandard stored values such as `ana@localhost` return `invalid`. Use `get_contact` with the literal ID instead.
  Raw email input accepts at most 320 characters, including surrounding whitespace.
  Raw domain input accepts at most 2048 characters, including any URL path.
  These request bounds limit parsing and database work. They do not change stored values or business policy.
  `matchType` compares the stored email with the original input spelling, before trimming or lowercasing.
  Domains use `normalizeDomain` and exact equality. No free-mail special case applies.
  Results contain `resolved`, `ambiguous`, `not_found` or `invalid`, up to 25 matches, and `truncated`.
  The default selects active records. `archived: true` selects archived records only, without hidden-archive hints.
- **`follow_ups` reads open tasks that the caller creates.** `timeZone` and `days` are required.
  `timeZone` uses an IANA name. `days` accepts 1–31. `limit` accepts 1–100 and defaults to 25.
  Optional `asOf` accepts an ISO datetime with an offset. It defaults to server now and returns in the response.
  `asOf` supports instants from `0002-01-01T00:00:00Z` inclusive to `9999-01-01T00:00:00Z` exclusive.
  UTC years 0002–9998 reserve representational margins within four-digit Gregorian years.
  Those margins cover timezone shifts, the maximum 32-date window, and the boundary search bracket.
  This technical range does not define business deadlines. Offset timestamps use their UTC instant for validation.
  Explicit timestamps and cursor timestamps use the same range. Unsupported instants return `BAD_REQUEST`.
  Timestamp strings and IANA names each accept at most 64 characters.
  Ordered boundaries satisfy `todayStart ≤ asOf < tomorrowStart ≤ windowEnd`. Invalid boundaries return `BAD_REQUEST` before database reads.
  Boundaries use local date starts, including daylight-saving transitions. Categories compare stored instants, not calendar-day intentions.
  `overdue` means `dueAt < asOf`. `due_today` means the remaining day: `asOf ≤ dueAt < tomorrowStart`.
  `next_days` means `tomorrowStart ≤ dueAt < windowEnd`. `windowEnd` starts the local date after the next `days` dates.
  `later` means `dueAt ≥ windowEnd`. `undated` means no `dueAt`.
  A UI calendar-day task stores local midnight. It becomes overdue once that instant passes.
  This query does not change `my_tasks`, the dashboard, stored deadlines, or legacy data.
  Tasks with any directly linked archived company, contact or deal are excluded. No parent cascade applies.
  Each item includes its category, local due date and existing activity entry.
  Each request reads items, category counts and total inside one read-only, repeatable-read transaction.
  `countedAt` records the transaction timestamp. Counts cover all pages, not only the returned items.
  Ordering uses `dueAt` ascending, nulls last, then ID ascending.
  The base64url JSON cursor binds the caller, `asOf`, `timeZone`, `days`, last deadline and last ID.
  A mismatched or malformed cursor returns `BAD_REQUEST`. An omitted `asOf` reuses the cursor instant.
  Each page reads current records. The cursor does not preserve a historical snapshot across requests.
  These queries also expose `GET /rest/search/resolve-customer` and `GET /rest/activities/follow-ups` on the API port.

### An API key carries a profile

A key is created with one profile (`api-keys/api-key-profiles.ts`), stored as
Better Auth's `permissions` on the key. `AuthMiddleware` verifies the key on
every call and `authorizeApiKeyProcedure` (`trpc/api-key-access.ts`) decides
from the stored permissions, never from the request.

| Profile | Permissions | What it can do |
| --- | --- | --- |
| `crm_integration` | `crm:read`, `crm:write` | Every query and mutation the user can, except purge |
| `agent_propose` | `crm:read`, `sales:read`, `sales:proposal:write` | Read, and file proposals for a human to approve |
| `agent_read` | `crm:read` | Queries only |
| `intake` | `intake:write` | Call `intake.submit` and nothing else |

- **A query needs `crm:read`; a mutation needs `crm:write`.** The `sales.*`
  procedures decide from the `sales` permissions instead (`sales/sales.auth.ts`):
  a read needs `crm:read` or `sales:read`, a proposal needs
  `sales:proposal:write`, and approval needs a human session, never a key.
  Rejection (`sales.rejectProposal`) is the same: a human session, a reason,
  and no CRM record changes.
- **A decided proposal never changes again.** Database triggers refuse any
  update to an approved or rejected proposal, and to an `APPROVED` or
  `REJECTED` request. A proposal holds one decision at most
  (`salesProposal_single_decision`).
- **`sales.reviewQueue` is the inbox.** It lists `PROPOSED` requests, which wait
  for a person, before `PENDING` ones, which wait for an agent, oldest first,
  with the total counts. It needs `sales:read` or `crm:read`. The MCP tool is
  `sales_review_queue`. Limits are in `sales/sales-config.ts`.
- **`apiKeys.*` is denied to every key.** Only a browser session manages keys.
- **`companies`, `contacts` and `deals` `purge` and `bulkPurge` are denied to every
  key,** legacy keys included. Archive and restore stay open to a write key.
- **A legacy key has null permissions.** It keeps non-sales CRM access. Every `sales.*` call requires explicit permissions.
  The existing table label says *Legacy: full access*. The owner rotates the key; discovery does not grant permissions.
- **The profile name says what the key can do, not which agent holds it.** The
  free-text `name` is where "hermes" or "openclaw" goes.
- **Each key is rate-limited.** `API_KEY_RATE_LIMIT` in `packages/auth/src/api-key-config.ts` allows 3,000 key checks per 60 s per key, and one tRPC or MCP call makes two checks. The count resets only after the key is idle for longer than the window, so a continuously busy agent can be paused for up to 60 s. A key over the limit gets `429` or `TOO_MANY_REQUESTS`, and other keys are not affected. Better Auth stores the numbers on each key row at creation, so changing them needs a migration that updates the `apikey` rows.
- **Every call a key makes leaves one `ApiKeyCall` row**: key id, procedure,
  `query` or `mutation`, and `allowed` or `denied`. `AuthMiddleware` writes it
  after the decision through `ApiKeyAuditService.record`, fire-and-forget: a
  failed write logs a warning and never fails the request. MCP tools reach the
  same middleware, so they are covered. A `sales.*` call records after the
  procedure runs: `denied` when it fails with `FORBIDDEN`, else `allowed`. **Never
  store arguments, headers or bodies** — they carry customer text. Settings → API
  keys shows the last 50 per key (`apiKeys.calls`, session-only). The archive
  prune deletes rows older than `archiveRetentionDays`, in batches.
- **`Authorization: Bearer crm_…` is accepted everywhere**, not only on the MCP
  endpoint. `keyFromHeaders` normalises it before the session is resolved.

## Inbound intake is one mutation behind a narrow key

`intake.submit` (`src/intake/`) files a lead from a form, an automation or a payment
hook. Only the web origin is exposed on StartOS, so it is a tRPC mutation reached at
`POST /api/trpc/intake.submit` with `Authorization: Bearer crm_…` and a plain JSON body.
The `intake` key profile holds `intake:write` and nothing else, so a key pasted into a
third-party handler can create leads but cannot read or change the CRM.
`crm_integration` and legacy keys can also call it. The MCP tool is `intake_submit`.

- **The email is the identity.** It goes through `normalizeEmail`. An existing contact,
  archived or not, is reused and gets one more note. A new one has `source` `INTAKE`.
- **A suppressed address or domain creates nothing.** The answer is `status: "suppressed"`
  with no contact id. Unlike `contacts.create`, intake never clears a suppression.
- **A new contact queues the agent.** `AgentTriggerService.contactCreated` writes the
  `identify` task and `contact.created` event. The API does no enrichment.
- **The key stays on a server.** Do not put it in browser JavaScript. Anyone who reads the
  page can then create leads, up to the per-key rate limit.
- **The note carries the message.** `meta` holds `source: "intake"` and the caller's
  `source` label. Every length limit is in `intake/intake-config.ts`.

## Two mail providers, one pipeline

`apps/api/src/mailbox` is everything neither Google nor Microsoft owns:
`MailboxApiClient` (bearer GET, and the one place a status code becomes an outcome),
`SyncStateService` (the `MailboxSync` row), `MailboxTokenService`,
`MailboxMatchService`, `participants.ts`, `message-text.ts`, and
`ThreadWriterService`.

- **`ThreadWriterService.store` is the only writer of `EmailThread`, `EmailMessage`
  and the `EMAIL` activity.** Gmail and Outlook each parse their own wire format down
  to one `IncomingMessage` and hand it over; matching, threading, counting and
  stamping happen once. A second copy of that is how a rule like *reply before you
  create a company* comes to be true in one inbox and not the other.
- **A thread is keyed by RFC message id, not by the provider's thread id.** Root comes
  from `References` → `In-Reply-To` → own `Message-ID`, so a rep on Gmail and a rep on
  Outlook land on the same `EmailThread` for the same conversation. Graph only returns
  `internetMessageHeaders` when `$select`ed and not for every message, so Outlook falls
  back to `outlook-conversation:<conversationId>` — threading that still holds inside
  Outlook, just not across to Gmail.
- **`MailboxSync.source` is the discriminator** — `calendar`, `gmail`, `outlook`. Each
  provider's module only ever sees its own, and `sync/mailbox-sync.service.ts` is the
  one place that dispatches. One cron, one budget:
  `POST /internal/sync/mailboxes` (`/google` is kept as an alias so an existing
  deployment's cron keeps working).
- **Gmail is forward-only from a `historyId`, Outlook from a timestamp.** Graph has no
  mailbox-wide delta, so the Outlook cursor is the last `receivedDateTime` seen,
  re-read with a one-second overlap; `rfcMessageId` is unique, so the overlap costs a
  duplicate fetch and never a duplicate row.
- **Microsoft has no token-revocation endpoint.** `revoke` clears the columns and the
  UI says the consent itself is removed in the user's Microsoft account. Google's still
  posts to `oauth2.googleapis.com/revoke` and refuses to clear if that fails.

## Not every address on a thread is a person

`externalParticipants` (`mailbox/participants.ts`) is the one gate, discarding **us**
(allow-list domains, `User` table), **rep decisions** (`SuppressedContact`,
`SuppressedDomain`), and **addresses no human reads**.

- **`isMachineDomain` (`companies/domain.ts`) sits beside `FREE_EMAIL_DOMAINS`**;
  `domainFromEmail` returns null for both, and `companyForEmail` is the only path from
  address to company — so a caller ignorant of the rule still cannot create one.
  `.calendar.google.com` covers shared calendars, rooms and ICS feeds.
- **Matches the host, never a substring** — `calendar.acme.com` is a real company.
- **`isMachineAddress` also catches opaque local parts** (24 hex chars, UUIDs),
  deliberately narrow: a false positive is a real customer never filed.
- **It leaves no row** — a rep may still type these into quick-add; only the *inbox*
  is barred from deciding. `syncAttendees` filters the same addresses beside
  `attendee.resource`.
- **`isAutomatedAddress` is a separate list about the local part** (`sales@`,
  `noreply@`), which is why `support@acme.com` never becomes a lead.

## People on a deal

`DealContact` is the join, and `deals.attachContact` / `detachContact` /
`setContactRole` are the only ways to write it. `deals.contactOptions` is what the
picker reads.

- **A contact on a deal works at that deal's company**, enforced in the service and
  not merely by the picker — the same rule as `companies.setPrimaryContact`.
- **Attaching is an upsert and re-attaching keeps the role already there**, so a
  double click cannot blank what somebody typed.
- **Detaching removes the row, never the contact.** They stay in the CRM, on the
  company, with their history.
- **`role` is blanked to null, never stored as `""`** — `blankToNull`, as everywhere
  else.

## Deleting a record is archive first, purge later

`contacts.archive`, `companies.archive`, `deals.archive` set `archivedAt`. Nothing
else changes — no suppression, no cascade cleanup, no stamp recompute — because the
row is still there, just filtered out of every list.

- **`archivedFilter(input.archived)` is in every `buildWhere` and every `facetCounts`
  where.** A list call defaults to `archived: false`; the Archived view is the same
  procedure with `archived: true`. There is no third "everything" mode — mixing
  active and archived rows in one table is exactly what this feature removes.
- **`archive`/`restore` are a bare `update({ archivedAt })`, nothing more.** They do
  not touch `AgentTask`, `SuppressedContact`, or `lastActivityAt` — the record is
  unchanged, only hidden.
- **`purge` is the old `delete`.** Same transaction, same suppression, same
  `AgentTask`/`AgentEvent` cleanup, same `ActivityStampService.recomputeAfterDelete`.
  Read the rest of this section as `purge`'s contract, not `archive`'s.
- **A rep can `purge` straight from the Archived view — retention is a ceiling, not a
  wait.** `bulkPurge`/the per-record "Delete forever" action call it directly, no
  different from the cron.
- **Only a workspace owner or admin can `purge` or `bulkPurge`, and no API key can.**
  The routers ask `AgentAccessService.assertCanPurge` (`canPurgeRecords`, `@crm/auth`)
  and answer a member with `FORBIDDEN`; `authorizeApiKeyProcedure` denies the six
  purge procedures to every key, so an agent archives and a human purges.
  `purgeExpired` calls the service directly and is not affected.

**Pruning**: `ArchiveRetentionController` (`internal/archive/prune`, `CRON_SECRET`-gated,
`apps/api/vercel.json`) reads `AppSetting.archiveRetentionDays`
(`readArchiveRetentionDays`, `@crm/db/settings`, default 180) and calls each service's
`purgeExpired(before)` — `findMany({ archivedAt: { lte: before } })` capped at
`ARCHIVE.prune.maxBatch` (`archive/archive-config.ts`), then `purge` per row through
the ordinary `runBulk`. Settings → General has the day count
(`settings.archiveRetention` / `setArchiveRetention`).

Below is `purge`'s contract — everything that used to be `delete`'s:

- **A purged contact is suppressed by address**, or the sync recreates them from the
  next thread. `ContactsService.purge` writes `SuppressedContact`, and
  `externalParticipants` drops it like a `SuppressedDomain` — one filter covering
  contact creation, company auto-creation and attribution.
- **Keyed lower case.** `normalizeEmail` (`crm/values.ts`) is the one canonicaliser,
  on `contacts.create`, `.update` and the suppression; conflict checks and `allowAgain`
  match case-insensitively.
- **The address comes from the delete itself**
  (`tx.contact.delete({ select: { email: true } })`), not a read before it — and the
  404 is that statement's own `P2025` through `translate`.
- **Adding them back lifts the suppression** via `allowAgain` **inside the write's
  transaction**. Never automatic.
- **Purging a company does not suppress its domain** — its people survive with no
  company, and domain suppression stays the explicit Settings → Connections control.
- **Clear `AgentTask` and `AgentEvent` yourself** — they carry `contactId`/`companyId`
  with no foreign key, so nothing cascades.
- **Recompute `lastActivityAt` on exactly the records the purge reached.**
  `ActivityStampService.targetsOf(where)` collects them *inside* the transaction (the
  evidence is what gets deleted); `recomputeMany` restamps. A company's `where` must
  follow its deals: `{ OR: [{ companyId }, { deal: { companyId } }] }`.
  `recomputeAll()` is for a purge only.
- **Recompute after commit, logging rather than throwing** — the row is already gone,
  and a raised error makes the browser skip invalidation and retry into a 404.

## Money

A deal is sold in one currency and reported in another, and **only `baseAmount` may
ever be summed**. The rules — `baseCurrency`, `countedWhere`/`pendingWhere`, frozen
rates, the supported currencies, the keyless feed, and why the fetcher is the one
documented exception to *no intelligence in the API* — are in **`docs/currency.md`**.
Read it before touching any amount, total, chart or rate.

## CSV leaves the CRM the same way it comes in

`apps/api/src/csv`. A rep moving away must be able to take every record along, so
export is a plain query, and an agent can call it too.

- **`csv.export` takes `entity`** (`companies`, `contacts`, `deals`) and returns
  `{ entity, filename, csv, rows, truncated }`. The MCP tool is `export_csv`. It is a
  query, so every key profile may call it, and it carries `readOnlyHint`.
- **Active records only.** `archivedAt` is null. Archived records never leave.
- **`CSV.export` (`csv-config.ts`) caps it.** `maxRows` stops the export, `truncated`
  says so, and `pageSize` is how many rows one read holds. The loop pages by id, so no
  read is unbounded.
- **`crm/csv.ts` is the only writer.** RFC 4180: a cell with a comma, a quote, CR or LF
  is quoted, inner quotes double, lines end in CRLF. A cell that starts with `=`, `+`,
  `-`, `@`, a tab or a CR gets a leading `'`, so a spreadsheet shows it as text.
- **Columns come from the update contracts** (`csv-columns.ts`), then one
  `field:<key>` column per active custom field, in field order. `id`, `source` and
  `createdAt` are information only.
  - companies: `id, name, domain, website, description, industry, city, stateCode,
    country, phone, email, linkedinUrl, ownerEmail, source, createdAt`
  - contacts: `id, firstName, lastName, email, phone, title, linkedinUrl, twitterUrl,
    githubUrl, companyDomain, companyName, ownerEmail, source, createdAt`
  - deals: `id, name, description, companyDomain, companyName, stage, closedReason, amount,
    currency, expectedCloseDate, ownerEmail, createdAt`
- **A deal `amount` is in major units** (`1234.50`) beside its `currency`. `baseAmount`
  never leaves, because it is derived (`docs/currency.md`).
- **Custom fields are written as people read them.** A SELECT is its option label, a
  USER is the user's email, a DATE is `YYYY-MM-DD` unless it has a time.
- **The browser downloads the text it gets back.** The list pages build a `Blob` from
  the query result with a BOM, so Excel reads UTF-8. There is no download route.

### Import: a dry run first, then the same file again

`csv.import` takes `{ entity, csv, dryRun, mapping? }` and returns
`{ dryRun, create, update, skip, errors[{ row, message }], skipped[{ row, message }], ignoredColumns }`.
Always send `dryRun: true` first. It reads and plans, and it writes nothing.

- **It is a mutation, so it needs `crm:write`.** A browser session and a
  `crm_integration` key can import. `agent_propose` and `agent_read` keys are denied by
  `authorizeApiKeyProcedure`. **There is no MCP tool for it**: an import is a bulk write
  that an agent cannot take back, so `export_csv` is the only CSV tool.
- **It reads the headers the export writes**, case-insensitively, so export then import
  round-trips. `id`, `source` and `createdAt` are read as nothing. `mapping` renames a
  header to a column (`{ "Account": "name" }`). A `field:<key>` column writes a custom
  field. Any other column is listed in `ignoredColumns` and left alone.
  - HubSpot names accepted: companies `Company name`, `Company Domain Name`, `Domain Name`,
    `Website URL`, `Phone Number`, `Country/Region`, `LinkedIn Company Page`; contacts
    `First Name`, `Last Name`, `Email Address`, `Phone Number`, `Job Title`,
    `Company Domain Name`, `Company Name`, `Associated Company`; deals `Deal Name`,
    `Deal Description`, `Deal Stage`, `Close Date`, `Company Domain Name`, `Company Name`,
    `Associated Company`. `Email`, `Phone`, `Industry`, `City`, `Amount` and the like
    already match a column.
  - **Stages** are the `DealStage` names or their words, in any case: `Closed won`,
    `CLOSED_WON`, `Unqualified`. A stage the CRM does not have is a row error.
- **Rows are validated with Zod.** A bad row is a line in `errors` with its row number
  and the other rows still run. Row 2 is the first row below the header. A row counts
  once, however many lines a quoted cell spans. A file with no usable header, an
  unclosed quote, or more rows or bytes than `CSV.import` allows is refused whole, with
  `BAD_REQUEST`.
- **Dedupe keys.** Companies match on `domain`; a company with no domain matches an
  active company with no domain and the same name. Contacts match on email, any case
  (`normalizeEmail`). Deals match on name plus company. Archived records never match.
  The same key twice in one file is an error on the second row.
- **A match is updated, and only where the file differs.** A blank cell never clears a
  value. A row that would change nothing is counted in `skip`. This matters for deals: a
  changed `amount` or `currency` goes through `deals.update`, which freezes a new rate
  (`docs/currency.md`), and an unchanged one is never sent, so re-importing an old file
  does not move a closed quarter.
- **Records first, associations second.** Contacts and deals name their company by
  `companyDomain`, or by `companyName` when the file has no domain. The company must
  already exist, so import companies, then contacts, then deals. A company that cannot
  be found is a row error. A contact with a company and no `companyDomain` keeps the
  company that `contacts.create` finds from the email domain, as for a manual create.
- **Writes go through `CompaniesService`, `ContactsService` and `DealsService`**, one
  call per row, so CRM events and the agent's `AgentTask` rows are written as for a
  manual create, and the frozen exchange rate comes from `ConversionService`. Created
  companies and contacts carry `source = IMPORT` (the services take it as an option, the
  tRPC inputs do not). A deal has no source. Each service call is its own transaction:
  a failed row never rolls back the others, and `MAX_BULK_IDS` rows form one batch.
- **A removed contact stays removed.** An email in `SuppressedContact` that has no active
  contact is counted in `skip`, with the reason in `skipped`. `contacts.create` lifts a
  suppression because a rep typed the address; a file is not a rep.
- **A deal needs an owner.** A blank `ownerEmail` is the person who runs the import.
  `ownerEmail` must be the email of a user; an unknown one is a row error.
- **`CSV.import` (`csv-config.ts`)** caps `maxRows` (500) and `maxBytes` (2 MiB). Every
  row is several writes and a Vercel function stops at 60 seconds. Split a bigger file.

## Freshness: invalidate the query, don't disable the cache

- **Invalidate in `onSuccess` through `useCrmCache()`** (`lib/trpc/cache.ts`), never by
  listing keys at the call site. Say what changed — `cache.deal(id)`,
  `cache.company(id)`, `cache.contact(id)`, `cache.activity()`. **A new mutation adds a
  call there, not a new list of keys.**
- **A deletion is `cache.removed(ref)`** — one wide fan-out, and the only place
  `refetchType: "none"` is right: the deleted record's `byId` query is still mounted
  while the sheet animates shut, so refetching reads a 404 into the closing sheet,
  while leaving it alone serves 30s of a dead record from cache.
- **`{ settle: "record" }`** for inline editors, so the field's spinner clears without
  waiting for the table.
- **Infinite queries need `pathKey()`, not `queryKey()`** — the latter stamps
  `{ type: "query" }` and silently cannot match `{ type: "infinite" }`.
  `activities.timeline` is read both ways.
- **`cache-manager` is per-value and opt-in**, not an interceptor;
  `AuthService.getProfile` is the model.
- **Background writes need polling, not invalidation** — `refetchInterval` while
  `PENDING`/`RUNNING`, via `isEnriching()` and `ENRICHMENT_POLL_MS`. **Lists poll too,
  not just the sheet.**
