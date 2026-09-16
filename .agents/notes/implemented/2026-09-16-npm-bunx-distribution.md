# Agent Note: npm distribution with a Bun command

Status: implemented

## Problem

Running the reader requires cloning the repository. An npm installation must expose a command and preserve the application and PDF.js asset paths even when the installer hoists dependencies outside the package directory.

## Decision

Publish `@ryqdev/ultra-learner` with an `ultra-learner` executable whose shebang selects Bun. Keep the existing runtime browser build and ship the TypeScript source and public assets through an explicit package file allowlist. The installed package reads its version from `package.json`; the CLI validates its port before starting the loopback server. Resolve PDF.js through the module resolver, independently of the application asset root.

The package uses the MIT license. PDF.js remains a declared dependency with its own licensing information rather than being copied into the package.

## Alternatives considered

**Prebuild the entire application.** This would add generated assets and separate development/production paths before startup performance requires them. Bun already provides the necessary build API on the user's machine.

**Support Node.js execution.** This would require replacing Bun's server and build APIs. npm distribution does not require Node.js compatibility.

**Assume a nested node_modules directory.** This works in the source checkout but fails for ordinary hoisted installations.

## Consequences

- Consumers can run the reader through bunx without a source checkout, but still need Bun installed.
- Package verification requires registry access and is a separate CI gate from deterministic behavior tests.
- The smoke test checks the actual archive in a clean consumer directory with a fresh cache and hoisted dependencies; no installation scripts or developer dependencies are needed.
- Uploaded PDFs and provider credentials are outside the package allowlist, and the package smoke test never opens the saved-session API.
