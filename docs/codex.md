# Codex — rules for AI agents

Covers each user's Codex connection: sign-in, storage, model routing, the
sales worker, and how other AIs reach it. Read `docs/api.md` and
`docs/agent.md` first. Written in ASD-STE100 per `AGENTS.md`.

## What is verified, and where

Every protocol fact below comes from source, not from memory. Re-check it
against the same files before you change it.

| Fact | Source |
| --- | --- |
| Client `app_EMoamEEZ73f0CkXaXp7hrann`, issuer `https://auth.openai.com` | `openai/codex` `codex-rs/login/src/auth/manager.rs`, `server.rs` |
| Device flow: `/api/accounts/deviceauth/usercode`, `/api/accounts/deviceauth/token`, 403 or 404 means pending, 15 minutes | `codex-rs/login/src/device_code_auth.rs` |
| Code exchange: form-encoded to `/oauth/token`, `redirect_uri=https://auth.openai.com/deviceauth/callback` | same file and `codex-rs/login/src/oauth/client.rs` |
| Refresh: JSON to `/oauth/token`; tokens rotate; `refresh_token_expired`, `refresh_token_reused`, `refresh_token_invalidated` end the session | `codex-rs/login/src/auth/manager.rs` |
| Revoke: JSON to `/oauth/revoke` with the refresh token | `codex-rs/login/src/auth/revoke.rs` |
| Backend `https://chatgpt.com/backend-api/codex`, Responses API, streaming, request fields | `codex-rs/model-provider-info/src/lib.rs`, `codex-rs/codex-api/src/common.rs` |
| Model list `/models?client_version=…`: `slug`, `display_name`, `visibility`, `priority`, `context_window` | `codex-rs/protocol/src/openai_models.rs` |
| `ChatGPT-Account-ID` from the JWT claim `https://api.openai.com/auth`.`chatgpt_account_id` | `codex-rs/login/src/token_data.rs`; Hermes `agent/codex_headers.py` |
| `store` must be false; `instructions` is required | OpenClaw `packages/ai/src/providers/openai-chatgpt-responses.ts`; Hermes `agent/transports/codex.py` |

Hermes (NousResearch `be5e9f72`) and OpenClaw (`45762faa`) run the same device
flow with the same client. The CRM sends its own `originator` (`crm-startos`),
as both of them send theirs.

## Terms

- OpenAI has not published `chatgpt.com/backend-api/codex` for third-party
  applications in any text this repository could read.
- OpenClaw states that OpenAI supports Codex sign-in in external tools. That
  is OpenClaw's statement, not OpenAI's.
- OpenAI's terms say a user may not share account credentials or make an
  account available to anyone else. So a connection belongs to one CRM user
  and only that user's work spends it.
- The OpenAI API key fallback is the sanctioned route. Offer it beside the
  ChatGPT sign-in.

## The rules

- **The agent owns all of it.** Sign-in, token exchange, sealing, refresh and
  model calls are in `apps/agent/agent/lib/codex/`. The API is a relay
  (`apps/api/src/codex/`), like `verify-key`.
- **One connection per user, used only by that user.** A research
  conversation binds the initiator's connection at `session.started`. Every
  step checks that the current caller is the same user; another caller gets
  the deny-only model.
- **Bound at the start, never switched.** A conversation started before a
  connection keeps its earlier route. A changed connection kind ends the
  conversation with `CODEX_UNAVAILABLE`.
- **Sealed, never returned.** `CRM_SECRETS_KEY` seals every credential with
  AES-256-GCM, bound to the user id. No tRPC, REST or MCP output carries a
  token. `apps/api/test/codex.spec.ts` fails when an output schema gains a
  credential-shaped field. API keys are refused on every `codex.*` procedure.
- **One refresh at a time.** `resolveCodexCredential` holds a row lock across
  read, refresh and write. Rotated refresh tokens are single-use, so two
  refreshes in parallel end the session.
- **Optional, never throws at boot.** Without `CRM_SECRETS_KEY` the status says
  Codex is off and nothing is stored.

## Other AIs

Hermes, OpenClaw, Claude Code and Codex reach Codex through the CRM's work,
never through its tokens:

1. The agent files a sales request over MCP with profile `crm-codex` and
   revision `sales-codex-v1` (`sales_create_request`).
2. The dispatch tick (`lib/sales-worker.ts`) leases it and runs the fixed
   extraction on the requester's Codex connection.
3. The proposal waits on the Sales page for a human.

Profile `crm-ollama` / `sales-qwen-v1` does the same on the Ollama service.
Profile `qwen-local-experimental` stays for agents that process the request
themselves. The CRM exposes no model proxy: that would make one user's plan
available to every key holder.

## Issues that stay open

1. RISK — OpenAI has not published the Codex backend for third parties. OpenAI can change or block it.
   Fix: the API key fallback. Move to OpenAI's sign-in program for apps when its documentation is verified.
2. UNKNOWN — The backend accepts `originator: crm-startos` from a StartOS address. This repository could not test it.
   Fix: connect once on a real install and read the agent log.
3. RISK — A refresh that succeeds while its transaction then fails loses the rotated token. The user must connect again.
   Fix: not done.
