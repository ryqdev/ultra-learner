# Architecture

Ultra Learner is a single-process Bun web application with browser-owned PDF rendering and server-owned local session persistence.

```text
PDF chosen on device ──→ browser memory ──→ PDF.js worker ──→ canvas + text layer
           │                    ↑                    ↓
           └─→ local session API│           reader controls ← page/zoom state
                        │       │
                        └─→ ~/.ultra-learner
                                                              ↓
                                                    SelectionContext → chat provider

Bun server ──→ HTML and CSS
           ├─→ bundled TypeScript application
           ├─→ local PDF session API
           └─→ PDF.js worker and standard fonts
```

## Browser application

`src/web/app.ts` is the composition root for the browser UI. `src/web/pdf-reader.ts` owns PDF.js loading, canvas rendering, the selectable text layer, thumbnails, page/zoom controls, and text/box selection events. `src/web/session-history.ts` owns the browser side of the local session API and history metadata formatting. `src/web/chat-panel.ts` owns the provider form, in-memory conversation, and chat composer. `src/lib/selection.ts` defines the small selection-context contract shared by the reader and chat modules, while `src/lib/chat.ts` validates provider settings and builds/executes OpenAI-compatible requests. Page number, zoom, fit scale, AI guide width, active render work, provider credentials, and messages remain ephemeral; only uploaded PDF bytes and immutable identifying metadata persist.

The reader validates the selected file before reading it. PDF.js parses a copy in browser memory; after parsing succeeds, the original bytes are posted to the same-origin session API for local persistence. No account or cloud service is involved, and the server binds to loopback by default. Text PDFs receive a PDF.js `TextLayer` positioned over the canvas, so browser selection and copying use the source text without changing the visual page. Image-only pages continue to render through the canvas but do not produce text selection context.

The chat panel sends only the user prompt and an explicitly selected, normalized text excerpt to the configured provider URL. The API key is held in JavaScript memory for the current tab and is not persisted in local storage, cookies, or the Bun server. Base URLs are restricted to HTTP(S), and the client uses the common `/chat/completions` contract so self-hosted OpenAI-compatible gateways can be used.

The PDF page surface has two selection modes. Text mode uses PDF.js's transparent positioned text layer for native browser selection. Box mode captures a pointer rectangle and collects intersecting text runs from that same layer. Both modes emit the same `SelectionContext`, so the chat panel does not depend on PDF.js or DOM details.

On desktop, the separator on the AI guide's left edge adjusts its grid track with pointer dragging or the arrow keys. The width is bounded to keep both the guide and main reading surface usable, and fitting is recalculated after the layout changes. Compact screens keep the guide as a fixed-width overlay instead of exposing the resize interaction.

The thumbnail rail is a flex-constrained vertical scroll region independent from the main page stage. The toolbar exposes the current page and total page count through a numeric jump field. When the reader has focus, `j` and `k` move the stage by a small fixed increment and change to the next or previous page when the matching scroll edge has been reached; `d` and `u` change pages directly. Form fields retain their normal typing behavior.

`src/web/sample.ts` creates a small valid PDF in memory. The sample enters through the same `loadPdf` function as a selected file, so it demonstrates the real rendering path rather than a separate mock screen.

`src/lib/` contains deterministic validation and reader-state helpers. These functions have no DOM or PDF.js dependency and carry the fine-grained behavior tests.

## Bun server

`src/server.ts` serves `public/`, exposes a small health endpoint, bundles the TypeScript browser entry with `Bun.build`, and serves the installed PDF.js worker and standard-font assets. It also exposes three same-origin session operations: list session summaries, create a session from raw PDF bytes, and retrieve one session's document.

`src/session-store.ts` owns filesystem access. The default root is `~/.ultra-learner`; each upload creates `sessions/<id>/metadata.json` and `sessions/<id>/document.pdf`. Metadata is versioned and contains the opaque ID, original filename, byte size, and creation time. IDs and filenames are validated at the boundary, stored files are never addressed by user-provided paths, and incomplete or malformed directories are omitted from history. The store is append-only in this iteration: creating another session never overwrites an earlier upload, and deletion is not yet exposed.

The browser bundle is built on request so `bun run start` remains the only setup command after dependency installation. Production packaging and asset fingerprinting are intentionally deferred until deployment is in scope.

## PDF rendering dependency

PDF.js is the only runtime dependency. PDF parsing is a complex, security-sensitive document-format concern and is kept out of bespoke application code. It runs in a web worker so parsing does not unnecessarily block interface interaction.

The interface itself uses browser APIs and repository-owned TypeScript, HTML, and CSS rather than a UI framework. This keeps the first prototype small while the product interaction model is still being established.

## Verification boundaries

- Unit tests cover PDF file recognition, display metadata, page constraints, zoom constraints, progress calculations, selection normalization, and OpenAI-compatible request behavior.
- Session tests cover metadata validation, filesystem layout, ordering, corrupt-entry handling, upload transport, and history formatting.
- The merged reader behavior also covers Vim navigation deltas through the reader-state helpers.
- HTTP tests cover the application shell, browser bundle, health endpoint, session creation/list/retrieval, method boundaries, and static-file containment.
- `bun run typecheck` covers server, browser, test, and repository-script TypeScript.
- Browser verification exercises the generated sample through the real PDF worker, canvas renderer, and responsive UI.

`bun run check` is the repository-wide local gate and also validates the agent-facing project structure.
