# AGENTS.md

This is a StartOS service-package repository — it builds a `.s9pk` for StartOS.

Develop it inside a StartOS packaging workspace created by `start-cli s9pk init-workspace`,
which provides the packaging guide and agent context one level up. If you're reading this in a
bare clone with no workspace, the full guide is at <https://docs.start9.com/packaging>.

**Start every task at the recipe index** — `../start-technologies/projects/start-sdk/docs/src/recipes.md`
(or <https://docs.start9.com/packaging/recipes.html>). It maps an intent ("prompt the user to create
admin credentials", "expose a web UI") to the constructs, the reference pages, and a named production
package to copy. Find the recipe before you read this package's neighbours: a package you reach by
grepping may be non-conformant, and the recipe outranks it.

Keep `README.md` (technical reference for an AI support or administering agent) and
`instructions.md` (end-user docs) in sync with your changes.

## This repo

- **The package lives inside the upstream fork.** This directory is `deploy/startos/` of
  <https://github.com/bitcoinRph/crm-startos>; the image is built from the repository root with the
  root `Dockerfile`. The workspace marker (`.startos/`) belongs two levels up, next to the
  repository, never inside it.
- **The CRM's own rules apply to the CRM.** Anything outside this directory follows the
  repository's `AGENTS.md`: Biome formatting, no code comments, `docs/api.md` before touching
  `apps/api`. This directory follows the SDK's Prettier config instead, and Biome ignores it.
- **Three env vars are this fork's, not upstream's**: `PASSWORD_SIGN_IN`, `API_INTERNAL_URL`, and
  the `local-account` script that `main.ts` runs as a oneshot. Keep `main.ts` and `.env.example`
  in step when they change.
- **The build needs the network.** `eve build` reads model metadata from the Vercel AI Gateway,
  so the image cannot be built offline. CI is the build path; see `.github/workflows/startos.yml`.
