# Agent Note: Release PR automation and npm uploads

Status: implemented

## Problem

Feature development should not require manual version edits or immediately publish every merged change. Maintainers need one reviewable release proposal, repeatable package verification, and recovery from a failed upload without changing the released source.

## Decision

Use Release Please's Node strategy for the single root package. Conventional Commits merged to main accumulate in one version/changelog PR. Merging that PR creates the tag and GitHub Release. The same workflow publishes the exact Bun tarball that passed the clean consumer smoke test.

Use GitHub's built-in token for release management and explicitly dispatch CI on bot-created release branches. Keep uploads in the release workflow because the built-in token's events cannot start ordinary PR or release workflows. OIDC permissions exist only on the publishing job. npm Trusted Publishing authenticates the upload without a stored npm token.

Bun remains the dependency manager, runtime, script runner, test runner, and packer. npm CLI is permitted only as the CI upload client and for checking that client's version. This narrow exception supersedes the original foundation's blanket prohibition on other package-manager commands. Bun's pending OIDC/provenance support is not a reason to maintain a second dependency workflow.

Only stable tags reachable from main may publish. Registry reads fail closed; an existing version is verified without re-uploading, and a new version cannot lower latest. Retries use the original tag. The first release uses an empty manifest and requires one maintainer-authenticated npm upload before its Trusted Publisher can be bound.

## Alternatives considered

**Publish every feature merge.** This removes the maintainer's release checkpoint and makes it harder to group related changes.

**Use Changesets.** Contributor-written release fragments become useful for multiple packages, but this single package can infer its version from conventional commit messages without another per-PR artifact.

**Use bun publish with a stored npm token.** This avoids the upload-client exception but requires maintaining a reusable publishing credential while Bun's native OIDC support remains unavailable.

## Consequences

- Merging a release PR is the publishing decision; opening an ordinary PR never publishes a package.
- Initial npm authentication and Trusted Publisher configuration are documented external setup steps. Code changes cannot prove that binding or an OIDC upload succeeded.
- The release workflow can recover from an interrupted upload without overwriting a version or downgrading latest.
- Release Please owns the version manifest; the CLI obtains its version from package.json, and Bun's root lockfile does not duplicate the package version.
