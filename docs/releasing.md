# npm releases

Ultra Learner is distributed as `@ryqdev/ultra-learner`. Consumers need Bun 1.3
or newer and run `bunx @ryqdev/ultra-learner`. GitHub Releases describe versions;
the npm upload is what makes a version available through bunx.

## Daily development

1. Keep version numbers unchanged in feature and fix PRs. Use Conventional
   Commits for the final commit on `main`; with squash merges, retain the PR
   title as the commit title.
2. After a merge to `main`, Release Please creates or updates one release PR.
   It owns `package.json`, `CHANGELOG.md`, and `.release-please-manifest.json`.
3. Review that PR and its CI, then merge it when ready to publish. It is not
   automatically merged. Multiple feature PRs may accumulate in one release.
4. The same workflow creates a version tag and GitHub Release, checks out that
   tag, verifies it, and publishes to npm through OIDC.

| Commit | Example change from 0.1.0 |
| --- | --- |
| `fix: correct PDF navigation` | 0.1.1 |
| `feat: add a reader feature` | 0.2.0 |
| `feat!: remove an interface` or a `BREAKING CHANGE:` footer | 1.0.0 |

The highest required increment wins. The default SemVer rules apply even
before 1.0. `docs:` and `chore:` changes generally do not trigger a release by
themselves. Preserve the generated release PR structure and labels.

## One-time setup and first publication

The package has no prior release. The manifest starts empty; `initial-version`
explicitly selects 0.1.0 for the first release. `bootstrap-sha` limits the initial
changelog to changes after the pre-packaging commit. Do not put 0.1.0 into the
manifest manually: that would represent an already released version.

Before merging the first generated release PR:

1. Merge the npm/bunx support PR, then the release automation PR into `main`.
   For stacked PRs, retarget the automation PR to `main` after the first merge
   and verify that its diff contains only automation changes.
2. In GitHub **Settings → Actions → General → Workflow permissions**, enable
   **Allow GitHub Actions to create and approve pull requests**. The default
   token permission can remain read-only; jobs declare the writes they need.
3. Verify the npm account has publishing rights to the `@ryqdev` scope. A GitHub
   username does not grant npm scope ownership.

npm Trusted Publishing is configured on an existing package. Bootstrap the
first version once using an authenticated maintainer session:

1. Merge the first release PR to create `v0.1.0`. Until the npm package exists,
   its publish job deliberately stops at the registry preflight with setup
   instructions; it does not interpret a 404 as permission to upload.
2. Check out that exact tag in a separate checkout:

   ```sh
   git fetch origin --tags
   git worktree add --detach ../ultra-learner-first-release v0.1.0
   cd ../ultra-learner-first-release
   bun install --frozen-lockfile
   bun run check
   bun run test:package ./ultra-learner.tgz
   bun publish ./ultra-learner.tgz --access public
   ```

   Authenticate using an existing user `.npmrc` or a short-lived granular npm
   token supplied as `NPM_CONFIG_TOKEN`. Complete any npm 2FA prompt. Keep
   credentials outside the repository; never put them in a PR or workflow.
   Publishing a tarball does not run lifecycle scripts, so the explicit checks
   above are required.
3. In the npm package settings, add **Trusted Publisher → GitHub Actions**:

   | Field | Value |
   | --- | --- |
   | Organization or user | `ryqdev` |
   | Repository | `ultra-learner` |
   | Workflow filename | `release-please.yml` |
   | Environment name | Leave empty |
   | Allowed actions | Allow direct `npm publish` |

   Enter only the filename, including `.yml`, not `.github/workflows/`.
   The repository URL in `package.json` must match this repository. Setup may
   require npm 2FA. No `NPM_TOKEN` GitHub secret is needed.
4. Retry `v0.1.0` with the command below. It skips the existing upload and
   verifies the published package. The first later version actually exercises
   OIDC authentication; a skipped upload alone does not verify the binding.

## Verification and upload

The workflow accepts only stable `vX.Y.Z` releases that are neither drafts nor
prereleases. The tag must belong to `main` history and match `package.json`.
Registry errors stop the job. Already published versions skip the upload;
new versions must be newer than `latest` so an old retry cannot roll it back.

Bun installs the frozen lockfile and runs `bun run check` and
`bun run test:package`. The latter creates the archive, checks its file
allowlist, and tests a clean consumer installation with hoisted dependencies.
The exact tested archive is uploaded, with lifecycle scripts disabled.

The sole npm CLI exception to the Bun-only toolchain is this authenticated CI
upload (and its client version check). Node 24 supplies npm; the workflow
requires npm >=11.5.1 for Trusted Publishing. All installation, checks,
packing, application execution, and registry verification use Bun. No npm
lockfile is created. Release jobs do not restore dependency caches.

After an upload, the workflow verifies the exact registry version and its
`latest` tag, then uses a fresh bunx cache outside the repository to check
help/version, startup, the browser bundle, and PDF.js assets. Retrying an older
existing version does not require or change `latest`.

The release manager uses the built-in `GITHUB_TOKEN`. Because its PRs do not
trigger ordinary PR CI, it explicitly dispatches `ci.yml` on the release
branch. Publishing remains in the same workflow because bot-created Releases
also do not trigger a separate release-event workflow.

## Recovery

To update a pending release PR manually:

```sh
gh workflow run release-please.yml --ref main
```

If the GitHub Release exists but npm publication or verification failed, fix
the setup problem and retry the same tag:

```sh
gh workflow run release-please.yml --ref main -f release_tag=v0.1.0
```

The retry always uses that tag's source. It never republishes an existing
version or moves `latest` for a skipped upload. Do not move tags or bump the
version to fix an authentication problem. Source fixes require a new fix PR
and version. Finish the pending npm release before merging another release PR.

To rerun CI on a generated release branch, use `gh workflow run ci.yml --ref`
with the branch name shown on that PR.

References: [Release Please](https://github.com/googleapis/release-please-action),
[npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/),
[Bun publishing](https://bun.com/docs/pm/cli/publish).
