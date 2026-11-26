# Agent Note: Remove the unreachable chat groundwork

Status: implemented

## Problem

The [model-configuration-only guide](2026-08-31-model-configuration-only-guide.md) decision removed the conversation interface but kept its machinery as groundwork: the `POST /api/chat/completions` proxy route, the browser completion client with its direct-transport option, message validation, the selection helpers, and the reader's box-selection mode. None of it had a caller. The cost was not only reading weight. The route was a live credential-forwarding endpoint that no feature used, the reader ran a selection handler on every `selectionchange` with nobody listening, and a toast in the unreachable box-selection path still told the learner to share text "with the chat".

## Decision

Delete what the interface cannot reach: the completions route and its payload parser, `requestChatCompletion` and the direct browser transport, chat message validation, `src/lib/selection.ts`, the reader's selection publishing and box-selection mode with its element and styles, and the tests that covered only those. Model discovery and the connection test stay, together with the shared provider-forwarding path they use. This supersedes the decision to retain that groundwork; the configuration-only guide itself is unchanged.

## Alternatives considered

**Keep the groundwork for the future learning workflow.** It would save rewriting a proxy handler and a client later, but that workflow is undecided, so the kept code was shaped by the removed conversation feature rather than by whatever comes next. The forwarding path a future route would actually build on remains, and the deleted pieces are recoverable from history.

**Keep the code but stop wiring it.** Removing only the route and the event listeners would close the endpoint and the idle handler while leaving the helpers. That keeps tests for code that cannot run in the product.

## Consequences

- The server exposes only the two model routes the configuration form calls; `/api/chat/completions` no longer exists.
- A model-backed feature must add its own route and client; it starts from `forwardToProvider` and the JSON payload reader instead of from a conversation-shaped proxy.
- Native text selection and copying are unaffected; they never depended on the removed publishing code.
- Earlier notes that describe the chat proxy, selection context, and box selection now describe history rather than shipped code.
