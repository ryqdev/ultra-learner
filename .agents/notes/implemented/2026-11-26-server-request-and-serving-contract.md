# Agent Note: Server request handling and serving contract

Status: implemented

## Problem

The server grew one hand-written handler per route. The completion proxy and the connection test carried the same provider call line for line, two functions repeated one bounded read loop, and the content-length guard was copied four times beside an existing helper. The copies had already drifted: model routes answered errors as `{ "error": { "message" } }` while session routes answered `{ "error": "…" }`, and a provider connection failure left its timeout timer running.

The server also treated every environment except `NODE_ENV=production` as development. An installed reader has no `NODE_ENV`, so users received Bun's development server, an unminified bundle rebuilt on every page load, and, when a build failed, Bun's diagnostic page instead of the handled reply, because a failed build rejects before the result can be inspected.

## Decision

Model routes share one bounded JSON reader and one provider-forwarding function that owns the timeout, the response size limit, and the pass-through response headers. Every API error reply, for model and session routes alike, is `{ "error": { "message": string } }`, the shape providers themselves use, so the browser needs a single parser. The browser's session client reads error bodies defensively and falls back to a route-specific message when a reply is not JSON.

Development behavior is opt-in: only `NODE_ENV=development`, which `bun run dev` sets, or the explicit `development` option selects it. Otherwise the server builds one minified browser bundle on the first request and serves that copy from memory. A failed build is logged and answered with a plain `500`, and is not cached, so a later request retries.

## Alternatives considered

**Keep per-route handlers and fix each drift.** This preserves the existing layout, but every limit or header change would still need to be made in several places and verified to match.

**Use the bare-string error shape everywhere.** Provider errors already arrive in the nested shape and are passed through unchanged, so the model client would have needed to keep parsing both.

**Keep rebuilding the bundle on every request.** It keeps one code path and always reflects the files on disk, but an installed package's sources do not change while it runs, so the work only repeats.

**Prebuild the bundle at publish time.** This removes the runtime build entirely but adds generated assets and a release step; the [npm distribution decision](2026-09-16-npm-bunx-distribution.md) already declined that, and an in-memory cache removes the repeated cost without it.

## Consequences

- A change to provider timeouts, size limits, or response headers is made once.
- The session API's error body changed shape. The browser client ships with the server, so no compatibility window is kept.
- Adding a model route means describing its payload parser and provider request rather than copying a handler.
- Editing browser code under `bun run start` now needs a restart; `bun run dev` keeps the edit-and-reload loop.
- The served bundle is roughly half the size, and repeat page loads no longer pay for a build.
