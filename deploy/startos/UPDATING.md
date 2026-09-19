# Updating the upstream version

This package builds its image from the source in this repository, not from a published tag. "Upstream" is [trycompai/crm](https://github.com/trycompai/crm), and this repository is a fork of it that carries the StartOS additions (`deploy/startos/`, the root `Dockerfile`, password sign-in and the MCP endpoint).

## Determining the upstream version

The version is the `version` field of the root `package.json`, which release-please bumps on every upstream release. The latest upstream release:

```sh
gh release view -R trycompai/crm --json tagName -q .tagName
```

The PostgreSQL sidecar is pinned by `images.postgres.source.dockerTag` in `startos/manifest/index.ts`. Tags: <https://hub.docker.com/_/postgres/tags?name=17>.

## Applying the bump

1. Merge upstream's `release` branch into this repository's `release` branch and resolve any conflict in the files this fork changes.
2. Set `version` in `startos/versions/current.ts` to `<root package.json version>:0` and write the release notes from upstream's `CHANGELOG.md`.
3. For a wrapper-only change, keep the upstream part and increment the number after the colon.
4. Bump the PostgreSQL tag only within major version 17; a major upgrade needs a data migration.
