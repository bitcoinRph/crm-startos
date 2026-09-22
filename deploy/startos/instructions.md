# CRM

## Documentation

- [Upstream README](https://github.com/trycompai/crm#readme) — how the CRM and its research agent work, and the Google and Microsoft OAuth walkthroughs.
- [Security policy](https://github.com/trycompai/crm/blob/release/SECURITY.md) — what the CRM assumes about who runs it and who signs in.
- [Model Context Protocol](https://modelcontextprotocol.io/) — the protocol the MCP interface speaks.

## What you get on StartOS

One service runs the web app, the API, the research agent and a PostgreSQL database. Your data stays on your server. The **Web UI** interface is where you work; the **MCP** interface is where an AI coding agent such as Claude Code, Codex or Hermes Agent connects with an API key.

Password sign-in is on, so nothing outside your network is needed to get in. Google or Microsoft sign-in, which also read your mailbox and calendar into the CRM, are optional and need a public address.

## Getting set up

1. Run **Set Sign-in Credentials**. Enter the email address you will use and leave the password empty to generate one. Copy both; the password is shown once.
2. Start the service and open the **Web UI** interface. Sign in with the email and password from step 1. The first account to sign in owns the workspace.
3. Complete the onboarding: name the workspace and enter your website. Research integrations remain optional and can be configured later.
4. Select one inference route:
   - Install **Ollama** from the marketplace, open its Ollama API interface and pull a model (for example `ollama pull qwen3.5:4b`). Then run **Configure Local Inference** and enter that model ID. The CRM finds the Ollama service on its own; there is no address to type.
   - Or run **Configure Research Agent** and provide a Vercel AI Gateway key for explicit legacy mode.
   - Leave both unset to keep inference disabled while the CRM remains available.

## Using CRM

### Web interface

Companies, contacts and deals live in the sidebar. Every record has an **Agent** tab where you can ask the research agent about that record and watch it work.

### Signing in with Google or Microsoft

Run **Configure Sign-in** and paste the client ID and secret of a Google OAuth client or a Microsoft Entra app registration. Google refuses `.local` addresses, so set **Public URL** to a real domain of this server and add `<Public URL>/api/auth/callback/google` (or `/api/auth/callback/microsoft`) to the provider's redirect URIs. Reps who sign in this way get their mail and calendar synced every five minutes.

### Letting other people in

**Configure Sign-in** has the allow-list: your email domain, or single addresses. Someone on the list signs in with Google or Microsoft once those are configured. For a password account, run **Set Sign-in Credentials** again with their address; this replaces the stored credentials, so your own account keeps working only if you already signed in with it once and the password was applied.

### Connecting an AI agent over MCP

1. In the web app, open **Settings → API keys** and create a key. Copy it; it is shown once.
2. Copy the address of the **MCP** interface.
3. Give both to your agent. The endpoint accepts the key in an `x-api-key` header or as `Authorization: Bearer <key>`.

Claude Code:

```sh
claude mcp add --transport http crm https://<your-crm-address>/api/mcp \
  --header "Authorization: Bearer crm_..."
```

Codex, in `~/.codex/config.toml`:

```toml
[mcp_servers.crm]
url = "https://<your-crm-address>/api/mcp"
bearer_token_env_var = "CRM_API_KEY"
```

Hermes Agent, in `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  crm:
    url: "https://<your-crm-address>/api/mcp"
    headers:
      Authorization: "Bearer crm_..."
```

The agent gets tools to search the CRM, read and update companies, contacts and deals, log notes and tasks, and queue research. It acts as the user who created the key. If your client does not trust your server's certificate, use the address's `http` form on your own network.

### Actions

- **Set Sign-in Credentials** — create or reset the password account. Takes effect on the next start.
- **Configure Sign-in** — the allow-list, the public URL, and Google or Microsoft sign-in.
- **Configure Research Agent** — explicit legacy Gateway mode and optional Perplexity, GitHub and Vercel Blob keys, plus telemetry.
- **Configure Local Inference** — the model ID pulled in the Ollama service and the output token cap. Leave the model ID empty to turn local inference off. While a model is set, the Ollama service is a required dependency and the CRM does not start without it.

## Limitations

- Local inference uses the verified 4096-token profile and supports fixed sales extraction. Builder and runner workflows require explicit legacy Gateway mode.
- Local configuration never falls back to cloud inference. A model failure becomes a visible failure.
- The agent's own shell runs in a pure-JavaScript sandbox with no real binaries, because StartOS has no Docker for it. Its research still works; scripts it writes for itself may not.
- The research agent reads web pages you did not choose. A page can carry text written to give the agent new instructions, and the agent can act on it with your CRM data. Give the agent a key only if you accept that.
- Sign-in tokens for Google and Microsoft, and any third-party keys you enter, are stored as plain text in the service's database. Your backups carry them too. Keep both private.
