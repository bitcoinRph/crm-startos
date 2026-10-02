# Connecting an agent

Hermes Agent, OpenClaw, Claude Code and Codex all reach the CRM the same way: the
Model Context Protocol endpoint at `/api/mcp`, authenticated with a CRM API key. The
endpoint is stateless Streamable HTTP with JSON responses (`apps/api/src/mcp/`), so
it works through the app's `/api/*` proxy and through buffering reverse proxies.

## One key per agent

Create one key per agent in **Settings → API keys**. The name is the agent
("hermes", "openclaw"); the profile is what it may do (`docs/api.md`, "An API key
carries a profile").

| Profile | Use it for |
| --- | --- |
| `agent_read` | An agent that only answers questions from the CRM |
| `agent_propose` | An agent that reads the CRM and files sales proposals for you to approve |
| `crm_integration` | A system you trust to change records directly |

A key is shown once. Revoke it from the same page; the agent loses access on its
next call.

## Hermes Agent

`~/.hermes/config.yaml`:

```yaml
mcp_servers:
  crm:
    url: "https://<your-crm-address>/api/mcp"
    headers:
      Authorization: "Bearer ${CRM_API_KEY}"
    trust: untrusted
    timeout: 300
```

`~/.hermes/.env`:

```sh
CRM_API_KEY=crm_...
```

Hermes substitutes `${CRM_API_KEY}` from that file, so the key never sits in the
config. With `trust: untrusted` Hermes reads each tool's `readOnlyHint` and asks
before a tool that writes. The CRM marks every query tool read-only.

## OpenClaw

```sh
openclaw mcp add crm \
  --transport streamable-http \
  --url "https://<your-crm-address>/api/mcp" \
  --header "Authorization: Bearer ${CRM_API_KEY}"
```

or in the OpenClaw config:

```json
{
  "mcp": {
    "servers": {
      "crm": {
        "transport": "streamable-http",
        "url": "https://<your-crm-address>/api/mcp",
        "headers": { "Authorization": "Bearer ${CRM_API_KEY}" }
      }
    }
  }
}
```

OpenClaw resolves `${CRM_API_KEY}` from its environment, redacts headers in its
logs, and `openclaw mcp doctor` warns when a literal secret sits in the config.
Gate the write tools with OpenClaw's tool policy if the agent should only read.

## Claude Code

```sh
claude mcp add --transport http crm https://<your-crm-address>/api/mcp \
  --header "Authorization: Bearer crm_..."
```

## Codex

`~/.codex/config.toml`:

```toml
[mcp_servers.crm]
url = "https://<your-crm-address>/api/mcp"
bearer_token_env_var = "CRM_API_KEY"
```

## What the tools do

`apps/api/src/mcp/mcp-tools.ts` is the list. Every tool is a tRPC procedure, so the
key's profile applies exactly as it does in the browser.

| Need | Tool | Profile |
| --- | --- | --- |
| Find and read records | `search_crm`, `list_contacts`, `get_contact`, `list_companies`, `get_company`, `list_deals`, `get_deal`, `timeline`, `my_tasks`, `dashboard_summary`, `whoami` | any |
| Change a record | `create_contact`, `update_contact`, `create_company`, `update_company`, `create_deal`, `update_deal`, `set_deal_stage`, `attach_contact_to_deal`, `log_activity`, `complete_task`, `enrich_*` | `crm_integration` |
| File a sales proposal | `sales_pending_requests`, `sales_get_request`, `sales_create_request`, `sales_store_proposal`, `sales_fail_request` | `agent_propose` |
| Approve a proposal | none. Approval is a human click on **Sales** in the web app | — |

A proposal must quote the request's source exactly; the server rejects anything
else. Name your model in `producedBy`. The CRM records which key filed each
proposal and shows it on the review page.

## Letting the CRM do the work on Codex or Ollama

`sales_create_request` takes a profile. It decides who processes the request:

| `profileId` / `profileRevision` | Who processes it |
| --- | --- |
| `qwen-local-experimental` / `sales-qwen-v1` | Your agent: read it with `sales_pending_requests`, answer with `sales_store_proposal` |
| `crm-ollama` / `sales-qwen-v1` | The CRM, on the Ollama service (needs **Configure Local Inference** with `qwen3.5:4b`) |
| `crm-codex` / `sales-codex-v1` | The CRM, on the Codex connection of the user who owns the key (Settings → General → Codex) |

So Hermes or OpenClaw spend your ChatGPT plan only through work the CRM does
for you, and the result still waits for your approval. Their own Codex sign-in
is separate: never copy a refresh token between the CRM, Hermes and OpenClaw.
Refresh tokens are single-use, and a copy ends both sessions at the next
refresh. `docs/codex.md` has the details.

## Checking a key from a shell

```sh
curl -sS "https://<your-crm-address>/api/mcp" \
  -H "Authorization: Bearer $CRM_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

`scripts/smoke-startos.sh` runs the whole path against a server: it creates a
contact, finds it over MCP, files a proposal with each agent key, proves a key
cannot approve, and checks the attribution. Without a valid certificate use the
address's `http` form on your own network.

On StartOS the web origin exposes `/api/mcp` and `/api/trpc/*`. The REST bridge
(`/rest`) lives on the API port, which the package does not expose, so an agent
on StartOS uses MCP.

## What leaves your server

Nothing, for these paths, unless a request names `crm-codex`. The agent process
holding the key is the only client, and the CRM calls no vendor for an MCP
request. A `crm-codex` request sends its note to OpenAI on the requester's
connection, and the Settings card shows **Sends to OpenAI** while it is on. Local inference talks to the
Ollama service on the same StartOS box (`deploy/startos/README.md`). The
optional Gateway, Perplexity, GitHub and Blob keys in **Configure Research
Agent** are the only egress, and each is off until you enter it.
