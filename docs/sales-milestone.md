# Disposable sales workflow

This milestone implements a fixed sales template. It does not restore generic builder or runner delegation.
Use synthetic data only.

## Who extracts

The supported path is an external agent over MCP or REST with an `agent_propose` key.
It reads `sales_pending_requests`, extracts with its own model, and stores the result with `sales_store_proposal`.
It names its model in `producedBy`. The CRM records the key that stored every proposal (`proposedByKeyId`) and the key that created every request (`requestedByKeyId`).
A request it cannot satisfy is closed with `sales_fail_request`.
`apps/agent/agent/lib/sales-extraction.ts` extracts with the local Ollama profile, but no scheduler calls it. `apps/agent/test/e2e/sales-worker.e2e.ts` drives it by hand against one synthetic request. Unattended in-CRM extraction is a follow-up (`FOLLOWUPS.md`).

## Contract

Open `/workspace/sales` inside the CRM.
Select the approved Qwen profile, load one explicit contact ID, and submit a short synthetic note.
The API records the source, contact snapshot, expected revision, selected profile revision, and server-generated keys.
The agent extracts at most three source-backed operations. It advertises no model tools.
The API stores pending operations separately from ContactFact. Pending proposals cannot enter automatic fact sweeps.
A current human session approves the exact immutable proposal and key.
One transaction applies Contact.title, NOTE, and TASK operations. Concurrent approval and replay reuse the approved result.
NOTE and TASK rows inherit companyId from the locked database contact, never from model output.
The same transaction updates company activity freshness without moving its timestamp backward.
A changed contact revision rejects approval. A failed extraction remains failed and cannot receive a later proposal.
Every operation value equals its exact source quotation. Human review determines semantic correctness.

## Permissions

Ordinary CRM API-key queries require `{ "crm": ["read"] }`.
Settings creates read-only keys. Existing keys without explicit read permission need separately approved replacement.
Sales request and pending reads require `{ "crm": ["read"] }` or `{ "sales": ["read"] }`.
Proposal-write alone never grants reads. Workers need both sales read and proposal-write permissions.
Creation and failure reporting require both permissions because their responses include the saved request.
Proposal submission also requires both permissions because replay returns saved approval audit and applied activity IDs.
Scoped API keys cannot directly mutate CRM records through REST, tRPC, or MCP without `crm:write`.
The separate `{ "sales": ["proposal:write"] }` permission permits submission only with explicit sales or CRM read authority.
Legacy keys without stored permissions retain baseline non-sales behavior during migration. They receive no sales access.
API keys cannot approve, including requests that also contain a human cookie.
New scoped keys require explicit `crm:write` for ordinary mutations. Read-only replacement keys do not restore write access.
MCP mutation advertisements do not grant authorization.
No production credentials change in this gate. Production worker provisioning and actual Hermes-client acceptance remain separate.
Recognized MCP Bearer keys follow the same key policy as `x-api-key`.
Valid keys take precedence over accompanying cookies, including another user’s cookie. Invalid keys do not inherit cookie permissions.
Unsupported Bearer headers do not authenticate. Ordinary reads with a valid cookie retain session behavior.
Sales reads and all mutations reject unsupported authorization headers. MCP has no approval tool.
The singleton workspace remains unchanged. This milestone does not add tenancy or per-customer ACLs.

## Model boundary

Only `qwen-local-experimental / sales-qwen-v1` is selectable. It names the extraction contract the API enforces, not the model that ran. The model is recorded in `producedBy`.
The operator configures `CRM_LOCAL_INFERENCE_JSON`; on StartOS the package computes it from the Ollama dependency. Users never supply endpoint URLs.
The in-CRM extractor verifies a listed Ollama version and an installed `qwen3.5:4b` before bounded native warmup.
Warmup requests 4096 context tokens. The existing guarded adapter verifies loaded context before extraction.
No model download, remote fallback, generic delegation, or outbound message delivery exists in this template.
The source limit is 2048 UTF-8 bytes. Extraction uses at most 768 output tokens and one bounded attempt.

## Verification boundary

The repository includes unit and integration-level tests for proposal validation, authorization, revision checks, and idempotent application.
A prior disposable environment exercised PostgreSQL, Nest, REST, tRPC, MCP, Next, and Chromium with injected synthetic extraction.
That environment and its machine-specific launch scripts are not part of the product source.
Live local inference, browser acceptance on the final revision, and StartOS restore remain separate release gates.

## Limits

The e2e worker script processes one matching synthetic request per invocation. It is not an unattended production scheduler.
Approvals are idempotent per request/proposal. A new intentional request is a separate approval and can create another task.
Tasks contain the exact requested action. This template does not infer dates, owners, or customer identity.
The profile revision identifies the reviewed configuration contract, not immutable model weights.
Release packaging, production egress, general agent lifecycle, and live model accuracy remain separate acceptance gates.
