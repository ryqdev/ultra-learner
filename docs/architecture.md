# Architecture

Ultra Learner is a single-process Bun web application with browser-owned PDF rendering and server-owned local session persistence.

```text
PDF chosen on device ──→ browser memory ──→ PDF.js worker ──→ canvas + text + annotation layers
           │                    ↑                    ↓
           └─→ local session API│           reader controls ← page/zoom state
                        │       │
                        └─→ ~/.ultra-learner

Model settings ──→ origin-local browser storage
       │
       └─→ model discovery and connection-test proxy

Bun server ──→ HTML and CSS
           ├─→ bundled TypeScript application
           ├─→ local PDF session API
           └─→ PDF.js worker and standard fonts
```

## Browser application

`src/web/app.ts` is the composition root for the browser UI. The Library view's persistent workspace sidebar presents local session history and Library navigation, with current-session highlighting, per-session deletion, collapse behavior on desktop, and a drawer on compact screens. Reading mode hides that workspace chrome and provides a compact return-to-Library control instead. PDF file selection stays in the focused home upload card, so the sidebar and reader toolbar do not duplicate that entry point. `src/web/pdf-reader.ts` owns PDF.js loading, canvas rendering, selectable text and annotation layers, thumbnails, and page/zoom controls. Its PDF.js `TextLayerBuilder` instance also owns the `.endOfContent` selection anchor and cross-browser drag-selection repair, preventing a selection from bleeding into the page margin. `src/web/pdf-link-service.ts` adapts PDF destinations and named page actions to the reader's one-page rendering model, while external URLs open in a separate tab and embedded attachments use a local blob download. `src/web/session-history.ts` owns the browser side of the local session API and history metadata formatting. `src/web/chat-panel.ts` owns the model-configuration-only AI Guide, including hosted/local presets, credential entry, model discovery, reasoning-level selection, connection testing, and saved-profile actions. `src/lib/chat.ts` validates provider settings, normalizes model catalogs, validates proxy payloads, and builds OpenAI-compatible requests. Page number, zoom, fit scale, AI Guide width, active render work, and unsaved form values remain ephemeral; uploaded PDF sessions persist on the local filesystem, while saved model profiles persist in origin-scoped browser storage.`

The reader validates the selected file before reading it. PDF.js parses a copy in browser memory; after parsing succeeds, the original bytes are posted to the same-origin session API for local persistence. No account or cloud service is involved, and the server binds to loopback by default. Text PDFs receive a PDF.js `TextLayerBuilder` positioned over the canvas, so browser selection and copying use the source text without changing the visual page. Image-only pages continue to render through the canvas but do not produce text selection context.

The provider settings form sends the API key and Base URL to `/api/chat/models` when the learner clicks Fetch models; Bun forwards the key in memory to the provider's `/models` endpoint and returns the catalog without putting the key in a URL or request body. `src/lib/chat.ts` accepts standard OpenAI model records plus common capability metadata, and conservatively maps a reasoning-capable model without explicit levels to low/medium/high choices. The form sends a minimal prompt to `/api/chat/test` so a learner can verify the selected model and reasoning intensity before saving it. A selected non-default intensity is sent to compatible completion endpoints as `reasoning_effort`; the default choice omits that provider-specific field. The browser stores named provider profiles, including their API keys, selected model, and optional reasoning intensity, in origin-scoped `localStorage` so the active model can be reused across PDF sessions on that device. The Bun process forwards keys in memory to the configured provider and never writes them to disk. Base URLs are restricted to HTTP(S), and model proxy routes apply request/response size limits and a timeout. The reader currently exposes no conversation, prompt composer, PDF-context handoff, or New chat action; the generic completion transport remains available as groundwork for a future learning workflow.

Reading mode removes the global and document title bars; a forty-pixel top strip owns the Library, thumbnail, page, zoom, fit, and AI Guide controls without covering the PDF page. Native browser selection remains available through PDF.js's transparent positioned text layer, but there is no AI-specific selection mode in the toolbar.

PDF.js's `AnnotationLayer` is rendered above the selectable text using the same page viewport. It preserves authored link rectangles, interactive form controls, popup annotations, attachment actions, and optional-content actions. Named and explicit destinations resolve through the browser-owned `PDFDocumentProxy`; the reader changes its current page and applies destination coordinates after rendering.

On desktop, the separator on the AI guide's left edge adjusts its grid track with pointer dragging or the arrow keys. The width is bounded to keep both the guide and main reading surface usable, and fitting is recalculated after the layout changes. Compact screens keep the guide as an opaque fixed-width overlay instead of exposing the resize interaction, preventing the underlying PDF from showing through the panel. The page-thumbnail rail also becomes an overlay at intermediate widths so the workspace sidebar, page rail, reader, and AI guide do not compete for four permanent columns. Each reader region owns an explicit grid column, so taking the thumbnail rail out of flow at those breakpoints does not shift the document or guide into the rail's zero-width placeholder.

The thumbnail rail is a flex-constrained vertical scroll region independent from the main page stage and starts closed so the current page receives the available width. The toolbar exposes the current page and total page count through a numeric jump field. Compact layouts keep the essential page controls in normal flex flow while progressively hiding secondary zoom controls, so controls cannot occupy the same coordinates. When the reader has focus, `j` and `k` move the stage by a short 56-pixel increment with a fast 90-millisecond ease-out animation and change to the next or previous page when the matching scroll edge has been reached; `d` and `u` change pages directly. Form fields retain their normal typing behavior.

`src/web/sample.ts` creates a small valid PDF with internal links in memory. The sample enters through the same `loadPdf` function as a selected file, so it demonstrates the real rendering and destination path rather than a separate mock screen.

`src/lib/` contains deterministic validation and reader-state helpers. These functions have no DOM or PDF.js dependency and carry the fine-grained behavior tests.

## Bun server

`src/server.ts` serves `public/`, exposes a small health endpoint, bundles the TypeScript browser entry with `Bun.build`, serves the installed PDF.js worker and standard-font assets, and proxies chat requests through `/api/chat/completions`, `/api/chat/models` model discovery, and the minimal `/api/chat/test` connection check. It also exposes four same-origin session operations: list session summaries, create a session from raw PDF bytes, retrieve one session's document, and delete one session.

`src/session-store.ts` owns filesystem access. The default root is `~/.ultra-learner`; each upload creates `sessions/<id>/metadata.json` and `sessions/<id>/document.pdf`. Metadata is versioned and contains the opaque ID, original filename, byte size, and creation time. IDs and filenames are validated at the boundary, stored files are never addressed by user-provided paths, and incomplete or malformed directories are omitted from history. Creating another session never overwrites an earlier upload. An explicit, confirmed delete removes the selected session directory and its saved PDF; deleting the active session returns the browser to Library.

The browser bundle is built on request so `bun run start` remains the only setup command after dependency installation. Production packaging and asset fingerprinting are intentionally deferred until deployment is in scope.

## PDF rendering dependency

PDF.js is the only runtime dependency. PDF parsing is a complex, security-sensitive document-format concern and is kept out of bespoke application code. It runs in a web worker so parsing does not unnecessarily block interface interaction.

The interface itself uses browser APIs and repository-owned TypeScript, HTML, and CSS rather than a UI framework. This keeps the first prototype small while the product interaction model is still being established.

## Verification boundaries

- Unit tests cover PDF file recognition, display metadata, page constraints, destination resolution, named actions, zoom constraints, progress calculations, selection normalization, OpenAI-compatible request behavior, model discovery and reasoning metadata normalization, provider connection tests, and saved-profile persistence rules.
- Session tests cover metadata validation, filesystem layout, ordering, corrupt-entry handling, upload and deletion transport, and history formatting.
- The merged reader behavior also covers Vim navigation deltas through the reader-state helpers.
- HTTP tests cover the application shell, browser bundle, health endpoint, chat/model proxy forwarding, session creation/list/retrieval/deletion, method boundaries, and static-file containment.
- `bun run typecheck` covers server, browser, test, and repository-script TypeScript.
- Browser verification exercises the generated sample through the real PDF worker, canvas renderer, and responsive UI.

`bun run check` is the repository-wide local gate and also validates the agent-facing project structure.
