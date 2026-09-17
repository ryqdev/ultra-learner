# Releasing to npm

Release Please collects changes merged into `main` into a release PR. Merging that
PR creates a version tag and GitHub Release, then the same workflow checks and
publishes the tagged package to npm. A successful CI check alone does not publish
a package. Review and merge the release PR when its accumulated changes are ready.

## Version rules

Use Conventional Commits in the commits that reach `main`. With squash merging,
keep the convention in the final squash commit; using it in PR titles helps.

| Commit | Next version after 0.1.0 |
| --- | --- |
| `fix: correct PDF rendering` or `perf: improve startup` | 0.1.1 |
| `feat: add a reader feature` | 0.2.0 |
| `feat!: remove an interface` or a `BREAKING CHANGE:` footer | 1.0.0 |
| Ordinary `chore:`, `docs:`, `test:`, or `ci:` | No release PR by itself |

Several changes take the highest required version increment. Maintenance changes
are still included in the next published package. No special pre-1.0 version
downgrading rules are enabled. Preserve the generated release PR's title, body,
and labels so Release Please can recognize it.

[release-please-config.json](../release-please-config.json) uses the `node` strategy
to update `package.json` and `CHANGELOG.md`; it does not change the Bun runtime.
The initial version is `0.1.0`. The bootstrap commit is the parent of the commit
that introduced npm packaging, so the initial release includes that feature.
[The manifest](../.release-please-manifest.json) starts empty because no version
has been released. Release PRs maintain it afterward. Do not bump it manually.

## First publish and Trusted Publisher setup

npm requires a package to exist before a Trusted Publisher can be configured.
For this package, the first authenticated publication is a one-time prerequisite:

1. Merge the automation change, then review and merge the initial `0.1.0` release
   PR. Release Please creates `v0.1.0`. The publish job reports the missing npm
   package until the following bootstrap is complete.
2. Check out `v0.1.0` in a clean checkout. With an npm account that can publish in
   the `@ryqdev` scope, run the commands below. Bun uses the account's existing
   registry authentication and may request browser/2FA confirmation for publishing.
   If no registry authentication is available, configure a publish-capable npm
   credential locally through `NPM_CONFIG_TOKEN`; never put it in repository files.

   ```sh
   bun install --frozen-lockfile
   bun run check
   bun run test:package /tmp/ultra-learner-0.1.0.tgz
   git diff --exit-code
   bun publish /tmp/ultra-learner-0.1.0.tgz --access public --tag latest --registry https://registry.npmjs.org/
   VERSION=0.1.0 PUBLISHED=true bun scripts/verify-npm-release.ts
   ```

3. In the [npm package settings](https://www.npmjs.com/package/@ryqdev/ultra-learner/access),
   add a GitHub Actions Trusted Publisher with the following fields. npm may
   require account authentication or 2FA when saving the binding.

   | Field | Value |
   | --- | --- |
   | Organization or user | `ryqdev` |
   | Repository | `ultra-learner` |
   | Workflow filename | `release-please.yml` |
   | Environment name | Leave empty |
   | Allowed actions | Allow direct publishing |

4. Retry the workflow with `release_tag=v0.1.0`. It skips the existing version and
   verifies the package from npm. The next new version exercises OIDC publication.

GitHub Settings → Actions → General → Workflow permissions must allow GitHub
Actions to create and approve pull requests. The default token permissions can
remain read-only; the release management job requests the writes it needs.

## Automated publication

[The workflow](../.github/workflows/release-please.yml) uses `GITHUB_TOKEN` for
release PRs and GitHub Releases. It explicitly dispatches CI for release PR
branches because bot-created PR events do not start ordinary CI automatically.
Publishing stays in the same workflow because bot-created release events also
do not trigger another workflow.

The publish job verifies a stable, non-draft GitHub Release, checks out its exact
tag, verifies ancestry on `main`, and matches the tag to `package.json`. Registry
errors stop publication. Existing npm versions skip uploading, and unpublished
versions older than `latest` are rejected.

It then installs with the frozen Bun lockfile, runs `bun run check`, and tests a
packed archive in a clean consumer directory. It publishes that same archive and
installs the exact version from npm with a fresh cache to verify the CLI, HTTP
server, browser bundle, and PDF.js assets. No separate application build step is
required: the package ships TypeScript and builds the browser bundle at runtime,
which the package smoke test exercises.

Bun does not currently exchange npm OIDC credentials itself. The small
[publishing adapter](../scripts/publish-npm.ts) requests a GitHub OIDC identity and
uses npm's documented token-exchange API, then passes the package-scoped,
short-lived credential directly to `bun publish`. Only this job receives
`id-token: write`; no persistent `NPM_TOKEN` secret is needed. This Bun publication
path does not generate a provenance attestation.

## Retry and recovery

Update the release PR without publishing:

```sh
gh workflow run release-please.yml --repo ryqdev/ultra-learner --ref main
```

If a GitHub Release exists but npm publication or verification failed, fix the
authentication/configuration problem and retry the same tag:

```sh
gh workflow run release-please.yml --repo ryqdev/ultra-learner --ref main -f release_tag=v0.1.0
```

Retries use the original tag, skip versions already on npm, and never move
`latest` to an older version. Do not move tags or bump a version just to retry an
upload. Source fixes require a new release. Finish the current npm publication
before merging another release PR. A GitHub Release alone does not prove that
the npm publish job succeeded.

References: [Release Please](https://github.com/googleapis/release-please-action),
[npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/),
[npm OIDC token exchange](https://api-docs.npmjs.com/#tag/OIDC),
[Bun publishing](https://bun.com/docs/pm/cli/publish).
