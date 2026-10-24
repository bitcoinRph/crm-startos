# Full Spectrum Audit: UI added by the agent-written commits

**Date**: 2026-10-24
**Mode**: Repo health, scoped to the UI that agent-written commits added
**Source**: `apps/app` and `packages/ui`, from `0f93129` (StartOS packaging) to `7347b89` (release 1.20.0). The fixes are on branch `claude/serene-gates-bgbbuu`.
**Lenses Run**: 9/10
**Lenses Skipped**: Backend Engineer. The lens audits Rust and Tauri code, and this repo has none.

Written in ASD-STE100, as `AGENTS.md` requires.

Scope: 59 files, +2885 / −244 lines. The main surfaces are the deal board (#37), CSV import and export (#43), the API key call log (#42), the intake page (#39), Slack post approval (#40), the Codex connection card and the sales proposal page.

How I checked:

- I read every changed UI file.
- I ran the stack locally with seeded data: PostgreSQL 16, the API and `next dev`.
- I took Playwright screenshots in light mode, dark mode, at 1440 px and at 390 px.
- I ran two flows from end to end: drag a deal to another column, and create a sales proposal request.

---

## Master Verdict: NEEDS REWORK (before the fixes) → APPROVE WITH CHANGES (after the fixes)

Before the fixes, the sales proposal page was a debugging form, not a product screen. The rep had to paste a raw contact ID, click "Load contact revision", read an ISO timestamp and pick a profile by its internal ID. On a phone, the deals page header covered its own title. Each board card used a font size that no other surface uses. A dropped card jumped back to its old column until the server answered.

The fixes on this branch correct these problems. They add stable `data-*` hooks and accessible names, so a browser agent can drive the board and the sales page. Some problems are still open, because each needs an API change or a product decision. The "Issues" section at the end lists them.

## Verdict by Lens

| # | Lens | Verdict (before) | Critical | Recommendations | State after fixes |
|---|------|------------------|----------|-----------------|-------------------|
| 1 | Design Engineer | NEEDS REWORK | 3 | 4 | Critical items fixed |
| 2 | UX Engineer | NEEDS REWORK | 3 | 4 | 2 of 3 fixed. Review inbox not done |
| 3 | Frontend Engineer | APPROVE WITH CHANGES | 1 | 3 | Critical item fixed |
| 4 | Backend Engineer | Skipped | – | – | – |
| 5 | Structural Engineer | APPROVE WITH CHANGES | 0 | 3 | 1 fixed |
| 6 | Repo Maintainer | APPROVE WITH CHANGES | 1 | 3 | Critical item fixed |
| 7 | Production Readiness | APPROVE WITH CHANGES | 1 | 3 | Critical item fixed |
| 8 | DX Engineer (automation and agents) | APPROVE WITH CHANGES | 2 | 3 | Critical items fixed in the UI. MCP gaps open |
| 9 | Performance Engineer | APPROVE | 0 | 2 | – |
| 10 | Accessibility Engineer | NEEDS REWORK | 3 | 3 | Critical items fixed |

## All Critical Issues (Must Fix)

| # | Issue | Lens(es) | File(s) | Impact | Fix | Status |
|---|-------|----------|---------|--------|-----|--------|
| C1 | The sales page asks for a raw contact ID, a manual "Load contact revision" click and a profile ID. | UX, Design, DX | `sales/sales-workflow.tsx` | A rep cannot file a proposal without opening the database or a URL. | Add a contact search picker. Load the revision on selection. Label profiles in words. Accept `?contactId=` in the URL. | Fixed |
| C2 | Sales status shows the raw enum (`PENDING`) in a badge. Operation cards show `contact_fact`. | UX, Design, A11y | `sales/sales-workflow.tsx` | The rep cannot tell what happens next. | Show status words ("Waiting for the agent") with a status indicator in an `aria-live` region. Keep the raw value in `data-status`. | Fixed |
| C3 | On a phone, the page header actions cover the title. | Design, Prod | `components/page-shell.tsx` | The deals, companies and contacts titles are unreadable below 640 px. | Use one column below `sm`, and put the actions under the description. | Fixed |
| C4 | Board cards use the browser's default 16 px font. The full-width stage button repeats the column name. | Design | `packages/ui/.../board.tsx`, `deals-board.tsx` | The board looks like a different app. | Use `text-xs/relaxed` on the card. Add a compact stage-menu variant: an icon button with a label. | Fixed |
| C5 | A dropped card goes back to its old column until the mutation and the refetch finish. | UX, Frontend | `deals-board.tsx` | Drag and drop feels broken on a slow server. | Apply the move at once from local state. Clear it when the mutation settles. | Fixed |
| C6 | Board cards have no accessible name, no per-item hook and no list semantics. | A11y, DX | `board.tsx` | Screen readers read "button". An agent cannot find a deal on the board. | Use `ul`/`li`, `aria-labelledby` on columns, `aria-label="Open …"` on cards, and `data-board-item` and `data-stage` hooks. | Fixed |
| C7 | The import dialog is 384 px wide and has no height limit. A pasted CSV grows the dialog off the screen. | Design, UX | `import-csv-dialog.tsx`, `dialog.tsx`, `textarea.tsx` | The Import button goes below the viewport. | Add a `size` prop to `DialogContent` and a max height with scroll. Add a `bounded` textarea size. | Fixed |
| C8 | `new Date().toLocaleString()` runs on prefetched server data in the Codex card. | Frontend, Prod | `codex-connection.tsx` | The server and the browser format the date differently, so hydration fails. | Use `LocalDateTime`. | Fixed |
| C9 | The page description says "approve or discard", but the page has no discard action. | UX | `sales/page.tsx` | The copy promises an action that does not exist. | Correct the copy. | Fixed (copy). Discard action not done |

## Cross-Cutting Concerns

| Concern | Flagged By | Root Cause | Unified Fix |
|---------|-----------|------------|-------------|
| Features built to prove an API, not to serve a rep | UX, Design, DX | The commits tested the contract (IDs, revisions, profiles) and gave the contract's form to the user. | Show words to people and IDs to machines. IDs go in a "Details" block and in `data-*` attributes. |
| No stable hooks for agents and automation | DX, A11y | Components had a `data-slot` but no item ids or states. | `data-board-item`, `data-stage`, `data-pending`, `data-count`, `data-status`, `data-operation` and `data-outcome`, plus accessible names on every control. |
| Call-site style overrides instead of variants | Repo, Design | `className="sm:max-w-(--container-*)"` on dialogs, and no size variants. | `DialogContent size`, `DescriptionList size`, `DescriptionDetails mono` and `Textarea size="bounded"` in `packages/ui`. |
| A missing review inbox | UX, DX | `sales.pendingRequests` returns only `PENDING`. Nothing lists `PROPOSED` requests. | A new `sales.reviewQueue` query, the `sales_review_queue` MCP tool and a list on the sales page. Done in the second pass. |

## All Recommendations

| # | Recommendation | Lens | File(s) | Fix | Status |
|---|---------------|------|---------|-----|--------|
| R1 | Show an empty-column hint on the board. | UX, Design | `board.tsx` | `empty` prop → "Drop a deal here." | Fixed |
| R2 | Show a drop-target ring while a card is over a column. | Design | `board.tsx` | `data-over:ring-2 ring-ring/40`, `transition-colors` | Fixed |
| R3 | Prefetch a record on keyboard focus, as on hover. | Frontend, A11y | `board.tsx` | `onFocus={onHover}` | Fixed |
| R4 | Give the Table/Board toggle a name. | A11y | `deals-table.tsx` | `aria-label="View"` | Fixed |
| R5 | Show a load error in the API key call log. | UX, DX | `api-key-calls-sheet.tsx` | `isError` text. Label `query`/`mutation` as Read/Write. | Fixed |
| R6 | Give the Slack-post Approve and Reject buttons context in their names. | A11y | `agent-history.tsx` | `aria-label="Approve the post to <destination>"` | Fixed |
| R7 | Show a column example in the import textarea, per entity. | UX | `import-csv-dialog.tsx` | `EXAMPLES` placeholder | Fixed |
| R8 | Replace Check/Import with Done after an import. | UX | `import-csv-dialog.tsx` | Conditional footer | Fixed |
| R9 | Give the sales rail item the same name as the page. | UX | `app-icon-rail.tsx` | "Sales proposals" | Fixed |
| R10 | Add a column money total on the board. | UX | `deals-board.tsx` | `deals.stageValues`: a `countedWhere` sum and a `pendingWhere` count per stage | Done (second pass) |
| R11 | Add a copy button for the intake endpoint URL. | DX | `connections/intake/page.tsx` | `InputGroup` + `CopyValue` | Done (second pass) |
| R12 | Add a way to discard or reject a proposal. | UX | API + `sales-workflow.tsx` | `sales.rejectProposal`, session only, reason required, enforced by database triggers | Done (second pass) |

---

# Lens Reports

---

## 1. Design Engineer

**Verdict**: NEEDS REWORK before the fixes. APPROVE WITH CHANGES after them.

### Files Reviewed
| File | Visual Role | Risk |
|------|-------------|------|
| `packages/ui/src/components/board.tsx` | Board surface, columns, cards | High |
| `apps/app/app/(app)/[slug]/deals/deals-board.tsx` | Deal cards | High |
| `apps/app/app/(app)/[slug]/sales/sales-workflow.tsx` | Sales page | High |
| `apps/app/components/crm/import-csv-dialog.tsx` | Import dialog | Medium |
| `apps/app/components/page-shell.tsx` | Page header layout | Medium |
| `packages/ui/src/components/description-list.tsx`, `egress-badge.tsx` | Shared primitives | Low |
| `settings/codex-connection.tsx`, `api-key-calls-sheet.tsx`, `intake/page.tsx` | Settings surfaces | Low |

### Critical Issues
| # | Issue | File(s) | Impact | Fix |
|---|-------|---------|--------|-----|
| 1 | The card text inherits the 16 px browser default. Every other surface uses `text-xs`. | `board.tsx` | The board looks like a separate product. | `text-xs/relaxed` on `BoardCard`. Fixed. |
| 2 | A full-width outline stage button on each card repeats the column title. | `deals-board.tsx` | The duplicate control doubles the visual weight of each card. | New `compact` variant in `stage-change.tsx`: a ghost `icon-xs` chevron. Fixed. |
| 3 | The phone header overlaps (see C3). | `page-shell.tsx` | The title is unreadable. | Single-column grid below `sm`. Fixed. |

### Recommendations
| # | Issue | File(s) | Why | Fix |
|---|-------|---------|-----|-----|
| 1 | No drop-target feedback except a background shift | `board.tsx` | The target is hard to see in dark mode. | Ring plus `transition-colors`. Fixed. |
| 2 | Width and font overrides at call sites | dialogs, sales | `docs/design.md`: "Do not override component styles with className". | Variants in `packages/ui`. Fixed. |
| 3 | Sales "Create" button was in a detached `CardFooter` | `sales-workflow.tsx` | Settings cards put the primary action in `CardAction`. | Moved to `CardAction`. Fixed. |
| 4 | The `blockquote` and the operation `li` use raw tokens | `sales-workflow.tsx` | They use scale tokens, but no shared quote or item component exists. | Not done. Acceptable for now. |

### Design System Compliance
All new colours are tokens (`muted`, `card`, `ring`, `primary`, `destructive`). No hex values were added. Radii come from the scale (`rounded-md`, `rounded-lg`). The new variants live in `packages/ui`. Two old call-site dialog overrides now use the new `size` prop (`create-channel-dialog.tsx`, `new-agent-dialog.tsx`). `add-connection-dialog.tsx` keeps its override, because it also moves the dialog off centre.

### Visual State Coverage
| Element | Hover | Focus | Active | Disabled | Loading | Empty | Error | Dark Mode |
|---------|-------|-------|--------|----------|---------|-------|-------|-----------|
| Board card | ring (fixed) | `has-focus-visible` ring (fixed) | grabbing cursor | – | `data-pending` | – | toast | checked |
| Board column | – | – | drop ring (fixed) | – | – | hint (fixed) | – | checked |
| Sales prepare form | yes | yes | – | yes | contact spinner (fixed) | guide text (fixed) | alert | tokens |
| Sales review | – | – | – | approve disabled | busy indicator (fixed) | pending text | agent error | tokens |
| Import dialog | yes | yes | – | yes | spinner | placeholder (fixed) | warning alert | tokens |
| API key calls | – | – | – | – | "Loading…" | "No calls yet." | fixed | tokens |

### Verdict Details
- Design Token Fidelity: PASS
- Visual State Coverage: PASS after fixes
- Dark Mode Parity: PASS. I checked the board in dark mode with a screenshot.
- Animation Quality: PASS. Only short colour and opacity transitions.
- Visual Consistency: CONCERNS before the fixes, PASS after them.

---

## 2. UX Engineer

**Verdict**: NEEDS REWORK before the fixes. APPROVE WITH CHANGES after them.

### User Journey Map: "Turn a customer note into a CRM update"
| Step | Before | After |
|------|--------|-------|
| 1. Find the page | WARN: the rail says "Sales", the page says "Sales proposals" | OK: one name |
| 2. Choose the customer | FAIL: paste a raw contact ID | OK: search by name or email, or deep-link `?contactId=` |
| 3. Confirm the revision | FAIL: click "Load contact revision" and read an ISO timestamp | OK: automatic. The email and current title are shown |
| 4. Choose the processor | WARN: `qwen-local-experimental / sales-qwen-v1` | OK: "An agent you connect over MCP processes it" |
| 5. Paste the note | OK | OK, with a character count and an example |
| 6. Wait | WARN: "Status: PENDING" | OK: "Waiting for the agent" with a busy indicator. "This page updates by itself." |
| 7. Review | WARN: cards titled `contact_fact` | OK: "Update a contact field · Field jobTitle", value and evidence |
| 8. Approve | OK | OK |
| 9. Find older proposals | FAIL: only by pasting a request ID | FAIL: still only by ID. Inbox not done |

### Critical Issues
| # | Issue | Step | Impact on User | Fix |
|---|-------|------|----------------|-----|
| 1 | Raw IDs for contact and revision | 2–3 | Most reps cannot finish the task. | Fixed (C1). |
| 2 | Board drop snaps back | Deal board | Drag and drop looks broken. | Fixed (C5). |
| 3 | No list of proposals that wait for review | 9 | A proposal filed by an agent is invisible unless someone shares its URL. | Not done. Needs `sales.reviewQueue`. |

### Recommendations
| # | Issue | Impact | Fix |
|---|-------|--------|-----|
| 1 | "approve or discard" copy with no discard action | Broken promise | Copy fixed. Discard not done. |
| 2 | Import dialog stays in "Check/Import" mode after a successful import | Unclear end state | "Done" button. Fixed. |
| 3 | Board shows only the first 100 open deals | A large pipeline is cut | The notice now has `role="status"`. Paging not done. |
| 4 | The "Open request" form was above the main task | It distracts from the primary flow | Moved below a divider, with help text. Fixed. |

### Interaction Consistency Check
- The contact picker reuses the shared `Combobox`, the same control as `CompanyPicker`.
- The sales primary action sits in `CardAction`, as on every Settings card.
- The board keeps the record sheet (`useOpenRecord`) as its click target, as the table does.

### Verdict Details
- Discoverability: PASS
- Flow Completeness: CONCERNS. No review inbox.
- Error Recovery: PASS. Retry, Start another request, optimistic rollback.
- Feedback & Status: PASS after the fixes.
- Consistency: PASS after the fixes.

---

## 3. Frontend Engineer

**Verdict**: APPROVE WITH CHANGES

### Critical Issues
| # | Issue | File(s) | Why It Breaks | Code Fix |
|---|-------|---------|---------------|----------|
| 1 | `toLocaleString()` on server-prefetched data | `codex-connection.tsx` | Hydration mismatch when the server locale differs from the browser locale. | `<LocalDateTime date options>`. Fixed. |

### Recommendations
| # | Issue | File(s) | Why | Fix |
|---|-------|---------|-----|-----|
| 1 | `codex.modelContextWindowTokens?.toLocaleString()` printed "undefined" | `codex-connection.tsx` | A null window renders the word "undefined". | Guarded. Fixed. |
| 2 | Contact selection was in local state | `sales-workflow.tsx` | A reload lost it, and nothing could deep-link it. | `useQueryState("contactId")`. Fixed. |
| 3 | `Combobox` uses `option.label` as the cmdk value | `combobox.tsx` (old code) | Two contacts with the same name share one cmdk value, so the keyboard highlight is ambiguous. | Not done. Use `value={option.value}` with `keywords=[label]`. |

### Render Path Analysis
- `DealsBoard` re-renders on each `deals.list` change and on each local `moves` change. `applyStageMoves` returns the same array contents when `moves` is empty. It is O(n), with n ≤ 100.
- `ContactPicker` runs a query only for 2 or more characters. `useSearchInput` debounces it.
- `SalesWorkflowContent` is keyed by `requestId`, so opening another request resets the local state.

### Type Safety Assessment
- Status and operation labels use `as const satisfies Record<…>`, which oxlint `anti-slop` requires.
- `SalesOperation` comes from `@crm/validation/sales` (`z.infer`).
- `callTypeLabel(type: string)` keeps the API's `string` type, because the column is free text in Prisma.

### Verdict Details
- Component Architecture: PASS
- State Management: PASS
- Type Safety: PASS
- Rendering Performance: PASS
- Bundle Impact: PASS. No new dependencies.

---

## 4. Backend Engineer

**Skipped**. The repo has no Rust or Tauri code. The API changes are out of scope for this UI audit.

---

## 5. Structural Engineer

**Verdict**: APPROVE WITH CHANGES

### Dependency Map
```
packages/ui (board, dialog, description-list, textarea)   ← no app imports
        ▲
apps/app components/crm/contact-picker ── trpc.search.quick
        ▲
apps/app sales/sales-workflow ── trpc.contacts.byId, trpc.sales.*
apps/app deals/deals-board ── lib/deal-board (pure) ── stage-change (mutation)
```
No client file imports `@crm/db` or `@crm/auth`. `@crm/validation/sales` is zod only, and the old code already imported it.

### Boundary Crossing Analysis
| Crossing | From → To | Clean? | Notes |
|----------|-----------|--------|-------|
| Contact search | app → `search.quick` | Yes | It reuses the quick-switcher endpoint. No API change. |
| Optimistic move | board → `useStageMutation` | Yes | Per-call `onSettled`. The shared hook is unchanged. |
| Dialog width | app → `packages/ui` variant | Yes | It replaces two call-site overrides. |

### Recommendations
| # | Issue | Why | Fix |
|---|-------|-----|-----|
| 1 | `stage-change.tsx` now has three trigger variants | It is close to the limit for one component. | Acceptable. Split it if a fourth variant comes. |
| 2 | The review inbox needs an API query | Listing proposals decides nothing, so it is allowed in Nest by `docs/api.md`. | Not done. |
| 3 | `applyStageMoves` lives in `lib/deal-board.ts` beside `dropDeal` | Good cohesion | Done. |

### Verdict Details
- Dependency Direction: PASS
- Module Coupling: PASS
- Cohesion: PASS
- Layer Boundaries: PASS
- Change Propagation: PASS

---

## 6. Repo Maintainer

**Verdict**: APPROVE WITH CHANGES

### Critical Issues
| # | Issue | File(s) | Convention Violated | Fix |
|---|-------|---------|---------------------|-----|
| 1 | Call-site `className` overrides on shared components | dialogs, sales | `docs/design.md` | Variants added in `packages/ui`. Fixed. |

### Convention Compliance Checklist
| Convention | Status | Notes |
|-----------|--------|-------|
| File placement | PASS | `contact-picker.tsx` sits beside `company-picker.tsx`. |
| Naming conventions | PASS | kebab-case files |
| Barrel exports | N/A | The repo imports by subpath. |
| Import ordering | PASS | `biome check` is clean. |
| Type imports separated | PASS | biome |
| Path aliases used | PASS | `@/` and `@crm/ui/...` |
| No dead code left | PASS | The old manual revision button and input are removed. |
| Structured logging | N/A | No logging added |
| No lint suppressions | PASS | None added |
| No code comments (`AGENTS.md`) | PASS | None added |
| Constants in a config module | PASS | Board and sales constants stay in `deal-board-config.ts` and `sales-workflow-config.ts`. `MIN_QUERY_LENGTH` sits beside its only use. |

### Reuse Opportunities
- `ContactPicker` mirrors `CompanyPicker`. A shared `RecordPicker` could serve both later.

### Verdict Details
- File Organization: PASS
- Naming Consistency: PASS
- Import Hygiene: PASS
- Code Reuse: PASS
- Lint Compliance: PASS (`biome`, `oxlint`, `tsc`)

---

## 7. Production Readiness

**Verdict**: APPROVE WITH CHANGES

### Critical Issues
| # | Issue | File(s) | Production Failure Mode | Fix |
|---|-------|---------|------------------------|-----|
| 1 | Hydration mismatch in the Codex card | `codex-connection.tsx` | React discards the server HTML and logs an error on each settings visit. | Fixed. |

### Failure Mode Analysis
| Scenario | What Fails | User Impact | Recovery | Handled? |
|----------|-----------|-------------|----------|----------|
| `setStage` rejects after a drop | Mutation | The card returns to its column and a toast shows the error. | `onSettled` clears the local move. | Yes |
| The contact is archived after selection | Create request | The server refuses the request. An alert shows the message. | Choose another contact. | Yes |
| `?contactId=` names a missing contact | `contacts.byId` | Alert with the API message | Choose another contact. | Yes |
| The agent never files a proposal | Poll | The page polls every 2 s while the tab is visible. | Start another request. | Partly. No timeout text. |
| A tall dialog on a short screen | Every dialog | The content now scrolls inside the dialog. | – | Yes. I checked the "Add a connection" dialog. |

### Environment Checklist
| Concern | Dev | Prod | Gap? |
|---------|-----|------|------|
| File paths | – | – | No |
| Network | `/api/trpc` | same origin on StartOS | No |
| Permissions | session | session | No |
| Config | no new variables | – | No |
| Build output | `next build` not run here | CI runs it | Yes, see the Issues list |

### Verdict Details
- E2E Flow: PASS. Checked in a browser.
- Error Recovery: PASS
- Data Integrity: PASS. The UI makes no new writes.
- Environment Parity: PASS
- Observability: PASS

---

## 8. DX Engineer (automation and autonomous agents)

**Verdict**: APPROVE WITH CHANGES

The CRM has two kinds of automated users: MCP agents (Hermes, OpenClaw, Claude Code, Codex) and browser agents that drive the UI. This lens checks both.

### Critical Issues
| # | Issue | Impact on Developer | Fix |
|---|-------|-------------------|-----|
| 1 | Board items had no machine hooks | A browser agent had to match visible text. | `data-board-item`, `data-stage`, `data-pending`, `data-count` and named buttons. Fixed. Verified with Playwright `dragTo`. |
| 2 | Sales state was visible only as styled text | An agent could not read the status reliably. | `data-status` on the request card, `data-operation` on each change, and `role="status"`. URL state: `?contactId=`, `?requestId=`. Fixed. |

### Recommendations
| # | Issue | Why | Fix |
|---|-------|-----|-----|
| 1 | The MCP surface has no tool that lists proposals waiting for review | An agent cannot hand a rep a review queue. | Not done. Same query as the UX inbox. |
| 2 | The REST bridge is not exposed on StartOS | OpenAPI tool servers (for example OpenWebUI) cannot reach `/rest`. | Not done. See `FOLLOWUPS.md` §C. |
| 3 | The API key call log shows raw procedure names | Good for debugging. Keep them. | Type column changed to Read/Write. Fixed. |

### Error Message Audit
| Error Scenario | Old Message | Suggested / New Message |
|---------------|-------------|------------------------|
| Any sales API error | "API error" + message | "The CRM refused the request" + message (fixed) |
| Call-log fetch fails | "No calls yet." (wrong) | "Could not load the calls. <message>" (fixed) |
| Contact without a valid revision | Alert, kept | Kept |

### Developer Journey
- First use: an agent creates a request over MCP and gets a request ID. The rep opens `/sales?requestId=…`.
- Daily use: an automation links a rep to `/sales?contactId=…`, and the contact is preselected.
- Power use: Playwright and computer-use agents can target `[data-board-item="…"]` and `[data-board-column="…"]`. Drag and drop and the "Change the stage of …" menu both work.

### Verdict Details
- Error Quality: PASS after the fixes
- Defaults & Config: PASS
- Keyboard Experience: PASS
- Discoverability: CONCERNS. No review inbox.
- Workflow Integration: PASS

---

## 9. Performance Engineer

**Verdict**: APPROVE

### Resource Budget
| Resource | Before | After | Concern? |
|----------|--------|-------|----------|
| Requests per board drop | 1 mutation + refetch | same | No |
| Requests per contact search | – | 1 debounced `search.quick` for 2 or more characters | No |
| Sales poll | 2 s while pending | same. React Query stops in background tabs | No |
| Memory growth | – | `moves` map, cleared on settle | No |
| Bundle | – | +1 small client file | No |

### Hot Path Analysis
Board render: `applyStageMoves` and `groupDealsByStage` each run once per render, with n ≤ 100. Contact search: debounced, `placeholderData` keeps the old results visible.

### Recommendations
| # | Issue | File(s) | Why | Fix |
|---|-------|---------|-----|-----|
| 1 | `applyStageMoves` runs again inside `onDropItem` | `deals-board.tsx` | It is negligible at 100 rows. | Keep it. |
| 2 | The pending sales poll has no upper limit | `sales-workflow.tsx` | A forgotten tab polls for as long as it is visible. | Not done. Stop after 10 min and show a message. |

### Verdict Details
- Memory Management: PASS
- IPC Efficiency: PASS
- I/O Patterns: PASS
- Startup Impact: PASS
- Long-Session Stability: PASS

---

## 10. Accessibility Engineer

**Verdict**: NEEDS REWORK before the fixes. APPROVE WITH CHANGES after them.

### Critical Issues
| # | Issue | WCAG | File(s) | Impact | Fix |
|---|-------|------|---------|--------|-----|
| 1 | Board card buttons had no name. Columns were unlabeled `section` elements. | 4.1.2, 1.3.1 | `board.tsx` | A screen reader announced "button" 100 times. | `aria-label="Open <deal>"`, `h2` + `aria-labelledby`, `ul`/`li`. Fixed. |
| 2 | Sales status changes were not announced | 4.1.3 | `sales-workflow.tsx` | A blind rep did not know when a proposal arrived. | `role="status" aria-live="polite"`. Fixed. |
| 3 | The Table/Board toggle group had no name | 4.1.2 | `deals-table.tsx` | "Toggle group" with no purpose. | `aria-label="View"`. Fixed. |

### Recommendations
| # | Issue | WCAG | Fix |
|---|-------|------|-----|
| 1 | Drag and drop is mouse only | 2.1.1 | The compact stage menu on each card is the keyboard path. Its name is "Change the stage of <deal>". Fixed. |
| 2 | The approve and reject buttons for Slack posts did not say what they approve | 2.4.6 | The name now includes the destination. Fixed. |
| 3 | `CardDescription` is `hidden` below `sm` | 1.3.1 | On a phone, the "No CRM records change before approval" text is hidden. Not done (shared component behaviour). |

### Keyboard Navigation Walkthrough
| Step | Action | Expected Focus | Expected Announcement | Handles? |
|------|--------|----------------|----------------------|----------|
| 1 | Tab into the board | First card | "Open Attio — expansion, button" | Yes |
| 2 | Tab | Stage menu | "Change the stage of Attio — expansion, button, menu" | Yes |
| 3 | Enter, arrows, Enter | Radio items | "Contract sent, radio, checked" | Yes |
| 4 | Sales: Tab to Contact | Combobox | "Contact, combobox, collapsed" | Yes |
| 5 | Type 2 letters | Results | The list updates. Empty text guides the user. | Yes |
| 6 | Submit | Request card | Status announced politely | Yes |

### ARIA Checklist
| Element | Role | Label | States | Keyboard | Notes |
|---------|------|-------|--------|----------|-------|
| Board | region via `aria-label` | "Deals by stage" | – | scroll | – |
| Column | `section` + `h2` | stage name | `data-over` | – | – |
| Card | `li` > `button` | "Open <name>" | `data-dragging` | Enter | – |
| Stage menu | `button` (menu) | "Change the stage of <name>" | expanded | Enter/arrows | – |
| Sales status | `status` | status words | live polite | – | – |
| Import report | `status` | – | live polite | – | – |

### Verdict Details
- Screen Reader Compatibility: PASS after the fixes
- Keyboard Navigation: PASS
- Focus Management: PASS. Radix handles dialogs.
- Color Contrast: PASS. Token pairs are unchanged.
- Motion Sensitivity: PASS. Only short colour transitions.

---

## Verification

| Step | Command | Result |
|------|---------|--------|
| Types | `tsc --noEmit` in `apps/app` and `packages/ui` | PASS |
| Lint | `biome check` (changed files), `oxlint` | PASS |
| Tests | `bun test` in `apps/app` against PostgreSQL 16 | 206 pass, 0 fail (6 runs) |
| Browser | Playwright: sign in, board drag, sales create, import check, phone width, dark mode | PASS |

## Second pass

The second pass implements every open item above. Each line names the evidence.

| Item | Outcome | Evidence |
| --- | --- | --- |
| Review inbox | Done | `sales.reviewQueue`, `sales_review_queue` MCP tool, `SalesReviewQueue` on the page. `sales-rejection.integration.spec.ts`, `sales-request-url.spec.tsx`, `mcp-bridge.spec.ts`. Browser: 3 rows, MCP and page counts agree. |
| Reject a proposal | Done | `sales.rejectProposal`, migration `20261024150000_sales_proposal_rejection` (status `REJECTED`, audit columns, two check constraints, triggers extended). 8 integration tests. Browser: reject, then approve on another request. |
| Board column totals | Done | `deals.stageValues`. `deal-stage-values.integration.spec.ts`. Browser totals equal a direct SQL sum of `baseAmount`. |
| `Combobox` value | Done | `value={option.value}`, label and hint in `keywords`. |
| Approval guarantee on phones | Done | Moved out of `CardDescription`. Browser at 390 px: visible. |
| Dialog max height | Checked | Import, Add a connection and Close as lost: each dialog fits a 600 px or 420 px window, and its primary button is reachable. |
| Pending poll limit | Done | `SALES_WORKFLOW.pollTimeoutMinutes`, "Check again" button. |
| Intake copy button | Done | `#intake-endpoint` with `CopyValue`. |
| `next build` | Done | Compiles. `/icon/*`, `/apple-icon` and the manifest prerender. |
| Bun 1.3.12 | Done | `turbo run test --force` on 1.3.12: 1,622 pass, 0 fail. |
| StartOS packaging | Done | Read-only audit against `ai-service-packaging` and SDK 2.0.9 types. Boilerplate equals `hello-world-startos` at `8484f70`. Ollama ids equal `Start9Labs/ollama-startos` at `a520a2a`. README fixes and `CONTRIBUTING.md`. |

## Issues

1. RISK — `crm-volume-owner` runs `chown -R` over all media on each start. Start time grows with the number of pictures.
   Fix: not done. A `find`-based chown needs `find` in the image. Docker Hub refused the pull (429), so I could not verify it.
2. UNKNOWN — `make x86` did not run locally. `start-cli` is not installed here.
   Fix: the `StartOS package` workflow builds both architectures on the pull request.
3. UNKNOWN — Start9's official guide at `docs.start9.com` returned 403 through the proxy.
   Fix: the maintained guide in `ai-service-packaging` and the SDK types were the sources.
4. UNKNOWN — The create-channel, new-agent and created-API-key dialogs were not opened in the browser after the max-height change.
   Fix: not done. They use the same `DialogContent`.
5. RISK — `README.md` in `deploy/startos` does not pass Prettier. It did not pass before this change either.
   Fix: not done. `s9pk.mk` does not check Markdown.
6. NOT DONE — The REST bridge is not exposed on StartOS. OpenAPI tool servers cannot reach `/rest`.
   Fix: see `FOLLOWUPS.md` §C. It needs a second interface or a proxy route.
7. NOT DONE — The manifest, the page title and the landing pages still say "Comp AI CRM".
   Fix: needs the business name. Not guessed.
