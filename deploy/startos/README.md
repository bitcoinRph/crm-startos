<p align="center">
  <img src="icon.svg" alt="CRM Logo" width="21%">
</p>

# CRM on StartOS

> **Upstream docs:** <https://github.com/trycompai/crm#readme>
>
> Everything not listed in this document should behave the same as upstream
> CRM. If a feature, setting, or behavior is not mentioned here, the upstream
> documentation is accurate and fully applicable.

[Comp AI CRM](https://github.com/trycompai/crm) is an open source, single-tenant CRM whose research agent fills in what it can prove about companies and contacts. This package runs the whole stack on one StartOS service and adds what a private server needs: a password sign-in, a scheduler for the routes Vercel Cron would call, and an MCP endpoint for AI agents.

---

## Table of Contents

- [Image and Container Runtime](#image-and-container-runtime)
- [Volume and Data Layout](#volume-and-data-layout)
- [Installation and First-Run Flow](#installation-and-first-run-flow)
- [Configuration Management](#configuration-management)
- [Network Access and Interfaces](#network-access-and-interfaces)
- [Actions (StartOS UI)](#actions-startos-ui)
- [Backups and Restore](#backups-and-restore)
- [Health Checks](#health-checks)
- [Dependencies](#dependencies)
- [Limitations and Differences](#limitations-and-differences)
- [What Is Unchanged from Upstream](#what-is-unchanged-from-upstream)
- [Contributing](#contributing)
- [Quick Reference for AI Consumers](#quick-reference-for-ai-consumers)

---

## Image and Container Runtime

| Image | Source | Architectures |
| --- | --- | --- |
| `crm` | Built by the root `Dockerfile` from this repository: Node 24 with Bun, `bun install --frozen-lockfile`, `bun run build` | x86_64, aarch64 |
| `postgres` | Official `postgres` image, 17 on Alpine | x86_64, aarch64 |

Six daemons and two oneshots run from those two images, in this order:

| Name | Kind | Command | Purpose |
| --- | --- | --- | --- |
| `postgres` | daemon | image entrypoint, `listen_addresses=127.0.0.1` | The database, loopback only |
| `migrate` | oneshot | `bunx prisma migrate deploy` in `packages/db` | Applies pending migrations on every start |
| `local-account` | oneshot | `bun scripts/local-account.ts` in `apps/api` | Creates or resets the password account from the store |
| `api` | daemon | `bun dist/main.js` in `apps/api`, port 3001 | NestJS API, tRPC, auth, MCP |
| `app` | daemon | `bun run start` (`next start`, `PORT=3000`) in `apps/app` | The web app; proxies `/api/*` to the API on its own origin |
| `agent` | daemon | `bun run start` (`eve start`, port 2000) in `apps/agent` | The eve research agent with its own schedule |
| `scheduler` | daemon | `node /assets/scheduler.mjs` | Calls the API's `/internal/*` cron routes with `CRON_SECRET` |

Only port 3000 is bound to an interface. The API and the agent are reachable on loopback inside the container only; the agent's `/eve/v1/*` routes accept any loopback request without a token, so the agent port must never be exposed.

## Volume and Data Layout

One volume, `main`:

| Path in volume | Mounted at | Contents |
| --- | --- | --- |
| `postgresql/` | `/var/lib/postgresql` in `postgres` | The database cluster (`PGDATA=/var/lib/postgresql/data`) |
| `agent/workflow-data/` | `/app/apps/agent/.eve/.workflow-data` in `crm` | eve's durable workflow runs |
| `agent/sandbox-cache/` | `/app/apps/agent/.eve/sandbox-cache` in `crm` | The agent's just-bash sandbox filesystem |
| `store.json` | not mounted; read by the package | Generated secrets, the sign-in and agent configuration, the password account |

`store.json` holds `postgresPassword`, `authSecret` (`BETTER_AUTH_SECRET`), `bridgeSecret` (`AGENT_BRIDGE_SECRET`), `cronSecret` (`CRON_SECRET`), `admin` (email and password of the password account), `signIn` and `agent` (the two configure actions).

## Installation and First-Run Flow

1. On install, `seedSecrets` generates the four secrets above.
2. `watchAdminCredentials` raises a critical task pointing at **Set Sign-in Credentials** while no password account is stored. The service cannot start until it is run.
3. On every start `main.ts` composes the environment from the store and the service's own addresses, runs the migrations, applies the password account, then starts the API, the app, the agent and the scheduler.
4. The first person to sign in becomes the workspace owner, as upstream; the web app then runs its own onboarding (workspace name, website, Context key).

There is no seed data. Upstream's `dev:session` script is not used.

## Configuration Management

| StartOS-managed (via actions and the store) | Upstream-managed (in the web app) |
| --- | --- |
| `ALLOWED_SIGN_IN` (allow-list plus the credentials email) | Workspace name, website, members and roles |
| `API_URL` (the public URL) and `APP_URL` (every non-local address of the Web UI) | Agent model, Context key, archive retention (Settings → General) |
| Google and Microsoft OAuth clients, Microsoft tenant | SSO providers (Settings → SSO), API keys (Settings → API keys) |
| `AI_GATEWAY_API_KEY`, `PERPLEXITY_API_KEY`, `GITHUB_TOKEN`, `BLOB_READ_WRITE_TOKEN`, telemetry | Slack connection, tracking settings |
| `PASSWORD_SIGN_IN=true`, `API_INTERNAL_URL`, `AGENT_URL`, all four secrets, `NODE_ENV=production` | — |

`APP_URL` is recomputed whenever the service's addresses change, so a new domain or a disabled gateway restarts the service with the right trusted origins. `API_URL` is the **Public URL** from **Configure Sign-in**, or else the first public address, or else the first address of the Web UI.

## Network Access and Interfaces

| Interface | Port | Protocol | Path | Purpose |
| --- | --- | --- | --- | --- |
| Web UI | 3000 | HTTP behind the StartOS proxy | `/` | The CRM |
| MCP | 3000 | HTTP behind the StartOS proxy | `/api/mcp` | Streamable HTTP MCP endpoint, authenticated with a CRM API key |

Both interfaces share one binding; the app proxies `/api/*` to the API, so the MCP endpoint and the tRPC/REST surface are on the web app's origin. Reachability (LAN, domain, Tor) is the user's choice on the Interfaces tab.

## Actions (StartOS UI)

| Action | Purpose | Availability | Inputs | Outputs |
| --- | --- | --- | --- | --- |
| Set Sign-in Credentials (`set-admin-credentials`) | Create or reset the password account; also surfaced as the install task | Any status; visible | Email; optional password (generated when empty) | Email and password, once |
| Configure Sign-in (`configure-sign-in`) | Allow-list, public URL, Google and Microsoft OAuth clients | Any status; visible | Text fields, secrets masked | — |
| Configure Research Agent (`configure-agent`) | AI Gateway, Perplexity, GitHub and Vercel Blob keys; telemetry switch | Any status; visible | Text fields, secrets masked; toggle | — |

Every action writes `store.json`; `main.ts` reads the store with `.const()`, so a change restarts the service.

## Backups and Restore

`sdk.Backups.withPgDump` dumps the `crm` database with `pg_dump` and restores it with `pg_restore` into a fresh cluster. The rest of the `main` volume is rsynced with `postgresql/` excluded, so `store.json` and the agent's workflow data travel with the backup.

## Health Checks

| Daemon | Check | Shown |
| --- | --- | --- |
| `postgres` | `pg_isready` against loopback | hidden |
| `api` | HTTP `GET http://127.0.0.1:3001/health` (checks the database) | **API** |
| `app` | port 3000 listening, 60 s grace | **Web Interface** |
| `agent` | port 2000 listening, 60 s grace | **Research Agent** |
| `scheduler` | always healthy once started | hidden |

## Dependencies

None.

## Limitations and Differences

1. **Password sign-in exists here and not upstream.** `PASSWORD_SIGN_IN=true` enables Better Auth's email-and-password sign-in with sign-up disabled; `apps/api/scripts/local-account.ts` writes the account. Everything else about authorisation is upstream's: `ALLOWED_SIGN_IN` still decides who may have an account.
2. **Google sign-in needs a public domain.** Google refuses `.local` redirect URIs. Set **Public URL** to a domain of this server; the Google and Microsoft callback paths are `/api/auth/callback/google` and `/api/auth/callback/microsoft` on that origin.
3. **The model is remote.** The agent reaches its model only through the Vercel AI Gateway; there is no local-model option in the code. Email content the agent reads leaves the server when it researches. Without the key the agent boots and every research session fails.
4. **The agent's sandbox is just-bash.** No Docker and no microsandbox exist inside the service, so eve's `defaultBackend()` falls through to the pure-JavaScript interpreter: a virtual filesystem with no real binaries and no network.
5. **Pictures need Vercel Blob.** Without `BLOB_READ_WRITE_TOKEN` contacts keep no photograph and logos are hotlinked, as upstream documents.
6. **Telemetry is off by default** (`CRM_TELEMETRY_DISABLED=1`), the reverse of upstream. The toggle is in **Configure Research Agent**.
7. **The scheduler replaces Vercel Cron.** `assets/scheduler.mjs` calls mailbox sync every five minutes and the rates, telemetry, retention and archive routes daily, each one minute after start.
8. **OAuth tokens and third-party keys are stored in plaintext in Postgres**, as upstream. The volume is the boundary.
9. **Removing someone from the allow-list does not sign them out**; upstream checks the list when a user is created. Delete the user or rotate the auth secret to revoke access.

## What Is Unchanged from Upstream

- The web app, the API, the tRPC and REST surfaces, the OpenAPI document and Swagger UI.
- The research agent: its tools, skills, dispatch schedule, evidence model and the Agent tab.
- Google and Microsoft mailbox sync, Slack connection, website tracking, custom fields, saved views, currencies.
- API keys (Settings → API keys) and the `x-api-key` header; the MCP endpoint reuses them.
- Onboarding, workspace roles, SSO providers added from Settings.

## Contributing

See [AGENTS.md](AGENTS.md).

---

## Quick Reference for AI Consumers

```yaml
package_id: crm
architectures: [x86_64, aarch64]
volumes:
  main: /var/lib/postgresql (postgresql/), /app/apps/agent/.eve/.workflow-data (agent/workflow-data/), /app/apps/agent/.eve/sandbox-cache (agent/sandbox-cache/)
ports:
  ui: 3000
  mcp: 3000 (/api/mcp)
dependencies: none
startos_managed_env_vars:
  - NODE_ENV
  - DATABASE_URL
  - BETTER_AUTH_SECRET
  - ALLOWED_SIGN_IN
  - PASSWORD_SIGN_IN
  - API_URL
  - API_INTERNAL_URL
  - APP_URL
  - AGENT_URL
  - AGENT_BRIDGE_SECRET
  - CRON_SECRET
  - CRM_TELEMETRY_DISABLED
  - GOOGLE_CLIENT_ID
  - GOOGLE_CLIENT_SECRET
  - MICROSOFT_CLIENT_ID
  - MICROSOFT_CLIENT_SECRET
  - MICROSOFT_TENANT_ID
  - AI_GATEWAY_API_KEY
  - PERPLEXITY_API_KEY
  - GITHUB_TOKEN
  - BLOB_READ_WRITE_TOKEN
actions:
  - set-admin-credentials
  - configure-sign-in
  - configure-agent
health_checks:
  - api: http://127.0.0.1:3001/health
  - app: port_listening 3000
  - agent: port_listening 2000
backup_volumes:
  - main (pg_dump for the database, rsync for the rest)
```
