# Agent Note: Same-origin chat proxy and per-PDF conversation sessions

Status: implemented

## Problem

The study companion called a user-configured model endpoint directly from the browser. Providers that did not allow the local reader origin through CORS surfaced only the opaque `Failed to fetch` error, making a valid API configuration appear broken. The reader also had no way to begin a separate conversation without reopening the PDF.

## Decision

Chat requests use a same-origin `POST /api/chat/completions` endpoint by default. The browser sends the validated provider base URL, model, messages, and tab-memory bearer key to the loopback Bun process. The server validates untrusted request data, forwards the common non-streaming `/chat/completions` request in memory, bounds request and response sizes, applies a timeout, and returns provider status or an actionable local/upstream error. A direct browser transport remains available as an explicit helper option for compatibility, but is not the UI default.

The workspace sidebar exposes `New chat`. It clears the in-memory chat messages, current selection, and active request while retaining the currently rendered PDF and provider configuration. This is a conversation boundary and does not create another persisted PDF session. The original reader-toolbar entry point was later removed by the [reader AI entry-point consolidation](2026-08-27-reader-ai-entry-point.md).

The later [model-configuration-only guide decision](2026-08-31-model-configuration-only-guide.md) removes the conversation UI and New chat action while retaining the proxy groundwork for future use.

## Alternatives considered

**Keep direct browser calls and document CORS setup.** This preserves one fewer server route, but requires every hosted or local gateway to configure the reader origin and turns normal network failures into browser-specific opaque errors.

**Persist provider credentials or chat transcripts.** Persistence could restore conversations across tabs, but would expand the local privacy and secret-management contract beyond the current prototype. Keys and messages remain memory-only.

**Treat New chat as a new PDF upload.** Reopening or duplicating document bytes would be slower and would pollute immutable PDF history; the requested behavior is a fresh conversation about the same open document.

## Consequences

- OpenAI-compatible providers no longer need browser CORS headers when the reader is served by Bun.
- The loopback server briefly handles the bearer key and provider URL, but never stores either value; users should still use a trusted local process and provider.
- Proxy limits and timeout prevent an accidental oversized request or hung upstream call from consuming the reader indefinitely.
- Provider HTTP errors remain visible to the chat panel, while DNS, connection, and timeout failures receive distinct actionable messages.
- Starting a new conversation intentionally discards the prior chat context and selection; the PDF page, zoom, and provider fields remain unchanged.
