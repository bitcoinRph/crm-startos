# Contributing to the CRM StartOS package

## Downloading and building the `.s9pk`

Built packages are published on the repository's [Releases](https://github.com/bitcoinRph/crm-startos/releases) page, one release per package version, tagged `startos-v<version>` with the colon written as a hyphen. Each release carries both architectures and a `checksums.txt`:

| File | Server |
| --- | --- |
| `crm_<version>_x86_64.s9pk` | Intel, AMD, and any x86 machine |
| `crm_<version>_aarch64.s9pk` | Raspberry Pi, Start9 Server Pure and Server One, and any ARM machine |

Download one, open your StartOS device in a browser, then click **Sideload** in the top navigation bar and select it.

`.github/workflows/startos.yml` builds both architectures on every push to `release` and on **Run workflow**. Only runs on `release` publish packages. A pull request that touches `deploy/startos/`, the root `Dockerfile` or `.dockerignore` builds the same packages and uploads them as run artifacts without publishing a release.

The release is named after `version` in `startos/versions/current.ts`, not after the repository's own tags. StartOS installs a package only when its version is higher than the installed one. Raise that version for each package release. Publication creates a new draft and publishes it after uploading both architectures and checksums. An existing release tag stops publication. The workflow never replaces existing assets.

To build locally instead, install [Docker](https://docs.docker.com/engine/install/), Node.js 22 or newer and [`start-cli`](https://start9.com/start-cli/install.sh), create a packaging workspace once in the directory that holds the clone, then build from this directory:

```sh
start-cli s9pk init-workspace .
npm ci
make x86
```

## Before you push

Run these in `deploy/startos`:

```sh
npm run check
bun test
```

`make x86` also runs the type check, the SDK lint runner and Prettier before it packs. The rules for agents that change this package are in [AGENTS.md](AGENTS.md).
