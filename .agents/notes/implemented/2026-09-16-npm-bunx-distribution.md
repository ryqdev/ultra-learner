# Agent Note: npm distribution with a Bun command

Status: implemented

## Problem

Running the reader requires cloning the repository. An npm installation must expose a command and preserve the application and PDF.js asset paths even when the installer hoists dependencies outside the package directory.

## Decision

Publish `@ryqdev/ultra-learner` with an `ultra-learner` executable whose shebang selects Bun. Keep the existing runtime browser build and ship the TypeScript source and public assets through an explicit package file allowlist. The installed package reads its version from `package.json`; the CLI validates its port before starting the loopback server. Resolve PDF.js through the module resolver, independently of the application asset root.

The package uses the MIT license. PDF.js remains a declared dependency with its own licensing information rather than being copied into the package.

Release Please manages a root-package release PR, version, changelog, tag, and GitHub Release. Merging the release PR initiates npm publication in the same workflow; the built-in GitHub token cannot trigger a separate publishing workflow. Release PR CI is explicitly dispatched for the same reason. The manifest starts empty and the initial version is 0.1.0 because this package has not previously been published.

Publication checks the tag against the package version and main history, rejects registry failures and downgrades of latest, and skips uploads for existing versions. Bun tests an archive before publishing that exact archive, then installs the exact registry version into an isolated consumer for verification. Manual retries use the original release tag.

Keep all package operations on Bun. A small adapter exchanges the GitHub workflow identity through npm's documented OIDC endpoint and passes the short-lived credential to Bun in memory. This avoids a second package manager and a persistent publishing secret. npm requires an existing package for Trusted Publisher setup, so the initial authenticated publish is a one-time prerequisite documented in [the release guide](../../../docs/releasing.md).

## Alternatives considered

**Prebuild the entire application.** This would add generated assets and separate development/production paths before startup performance requires them. Bun already provides the necessary build API on the user's machine.

**Support Node.js execution.** This would require replacing Bun's server and build APIs. npm distribution does not require Node.js compatibility.

**Assume a nested node_modules directory.** This works in the source checkout but fails for ordinary hoisted installations.

**Manual versioning and publication for every release.** This leaves the changelog, source tag, and registry artifact dependent on repeated manual coordination. A reviewable release PR collects those decisions and preserves an explicit release point.

**Publish using the npm CLI for its built-in OIDC support.** This introduces a second package manager despite the repository's Bun-only contract. The documented token exchange is small enough to keep local; Bun currently does not generate provenance attestations.

## Consequences

- Consumers can run the reader through bunx without a source checkout, but still need Bun installed.
- Package verification requires registry access and is a separate CI gate from deterministic behavior tests.
- The smoke test checks the actual archive in a clean consumer directory with a fresh cache and hoisted dependencies; no installation scripts or developer dependencies are needed.
- Uploaded PDFs and provider credentials are outside the package allowlist, and the package smoke test never opens the saved-session API.
- The maintainer configures a GitHub Actions Trusted Publisher after the first authenticated npm publication; later releases need no persistent registry secret.
- A GitHub Release can exist before npm publication succeeds. Recovery retries its original tag without duplicating a version or rolling back latest.
- The Bun OIDC adapter needs maintenance until Bun provides native trusted publishing; it provides short-lived authentication but no provenance attestation.
