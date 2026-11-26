# Agent Note: Server request handling and serving contract

Status: implemented

## Problem

The server grew one hand-written handler per route. The completion proxy and the connection test carried the same provider call line for line, two functions repeated one bounded read loop, and the content-length guard was copied four times beside an existing helper. The copies had already drifted: model routes answered errors as `{ "error": { "message" } }` while session routes answered `{ "error": "…" }`, and a provider connection failure left its timeout timer running.

## Decision

Model routes share one bounded JSON reader and one provider-forwarding function that owns the timeout, the response size limit, and the pass-through response headers. Every API error reply, for model and session routes alike, is `{ "error": { "message": string } }`, the shape providers themselves use, so the browser needs a single parser. The browser's session client reads error bodies defensively and falls back to a route-specific message when a reply is not JSON.

## Alternatives considered

**Keep per-route handlers and fix each drift.** This preserves the existing layout, but every limit or header change would still need to be made in several places and verified to match.

**Use the bare-string error shape everywhere.** Provider errors already arrive in the nested shape and are passed through unchanged, so the model client would have needed to keep parsing both.

## Consequences

- A change to provider timeouts, size limits, or response headers is made once.
- The session API's error body changed shape. The browser client ships with the server, so no compatibility window is kept.
- Adding a model route means describing its payload parser and provider request rather than copying a handler.
