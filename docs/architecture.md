# Architecture

Ultra Learner is a single-process Bun web application with a browser-owned PDF reading session.

```text
PDF chosen on device ──→ browser memory ──→ PDF.js worker ──→ canvas + text layer
                                ↑                    ↓
                         reader controls ← page/zoom state
                                                              ↓
                                                    SelectionContext → chat provider

Bun server ──→ HTML and CSS
           ├─→ bundled TypeScript application
           └─→ PDF.js worker and standard fonts
```

## Browser application

`src/web/app.ts` is the composition root for the browser UI. `src/web/pdf-reader.ts` owns PDF.js loading, canvas rendering, the selectable text layer, thumbnails, page/zoom controls, and text/box selection events. `src/web/chat-panel.ts` owns the provider form, in-memory conversation, and chat composer. `src/lib/selection.ts` defines the small selection-context contract shared by those modules, while `src/lib/chat.ts` validates provider settings and builds/executes OpenAI-compatible requests. Page number, zoom, fit scale, AI guide width, active render work, provider credentials, and messages remain ephemeral; reloading the page deliberately clears the session.

The reader never posts selected PDF bytes to an application endpoint. The privacy boundary is structural rather than policy-only: the server exposes no upload route, while browser APIs read the selected file into local memory. Text PDFs receive a PDF.js `TextLayer` positioned over the canvas, so browser selection and copying use the source text without changing the visual page. Image-only pages continue to render through the canvas but do not produce text selection context.

The chat panel sends only the user prompt and an explicitly selected, normalized text excerpt to the configured provider URL. The API key is held in JavaScript memory for the current tab and is not persisted in local storage, cookies, or the Bun server. Base URLs are restricted to HTTP(S), and the client uses the common `/chat/completions` contract so self-hosted OpenAI-compatible gateways can be used.

The PDF page surface has two selection modes. Text mode uses PDF.js's transparent positioned text layer for native browser selection. Box mode captures a pointer rectangle and collects intersecting text runs from that same layer. Both modes emit the same `SelectionContext`, so the chat panel does not depend on PDF.js or DOM details.

On desktop, the separator on the AI guide's left edge adjusts its grid track with pointer dragging or the arrow keys. The width is bounded to keep both the guide and main reading surface usable, and fitting is recalculated after the layout changes. Compact screens keep the guide as a fixed-width overlay instead of exposing the resize interaction.

The thumbnail rail is a flex-constrained vertical scroll region independent from the main page stage. The toolbar exposes the current page and total page count through a numeric jump field. When the reader has focus, `j` and `k` move the stage by a small fixed increment and `d` and `u` change pages; form fields retain their normal typing behavior.

`src/web/sample.ts` creates a small valid PDF in memory. The sample enters through the same `loadPdf` function as a selected file, so it demonstrates the real rendering path rather than a separate mock screen.

`src/lib/` contains deterministic validation and reader-state helpers. These functions have no DOM or PDF.js dependency and carry the fine-grained behavior tests.

## Bun server

`src/server.ts` serves `public/`, exposes a small health endpoint, bundles the TypeScript browser entry with `Bun.build`, and serves the installed PDF.js worker and standard-font assets. It accepts only `GET` and `HEAD`; there is no persistence, account, database, or upload API in this prototype.

The browser bundle is built on request so `bun run start` remains the only setup command after dependency installation. Production packaging and asset fingerprinting are intentionally deferred until deployment is in scope.

## PDF rendering dependency

PDF.js is the only runtime dependency. PDF parsing is a complex, security-sensitive document-format concern and is kept out of bespoke application code. It runs in a web worker so parsing does not unnecessarily block interface interaction.

The interface itself uses browser APIs and repository-owned TypeScript, HTML, and CSS rather than a UI framework. This keeps the first prototype small while the product interaction model is still being established.

## Verification boundaries

- Unit tests cover PDF file recognition, display metadata, page constraints, zoom constraints, progress calculations, selection normalization, and OpenAI-compatible request behavior.
- The merged reader behavior also covers Vim navigation deltas through the reader-state helpers.
- HTTP tests cover the application shell, browser bundle, health endpoint, method boundary, and static-file containment.
- `bun run typecheck` covers server, browser, test, and repository-script TypeScript.
- Browser verification exercises the generated sample through the real PDF worker, canvas renderer, and responsive UI.

`bun run check` is the repository-wide local gate and also validates the agent-facing project structure.
