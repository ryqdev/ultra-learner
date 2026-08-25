# Architecture

Ultra Learner is a single-process Bun web application with a browser-owned PDF reading session.

```text
PDF chosen on device ──→ browser memory ──→ PDF.js worker ──→ canvas + text layer
                                ↑                    ↓
                         reader controls ← page/zoom state

Bun server ──→ HTML and CSS
           ├─→ bundled TypeScript application
           └─→ PDF.js worker and standard fonts
```

## Browser application

`src/web/app.ts` owns the interactive reading session. It validates selected files at the browser boundary, gives their bytes directly to PDF.js, renders one high-resolution main page at a time, and creates lightweight page thumbnails. Page number, zoom, fit scale, and active render work remain ephemeral; reloading the page deliberately clears the session.

The reader never posts selected PDF bytes to an application endpoint. The privacy boundary is structural rather than policy-only: the server exposes no upload route, while browser APIs read the selected file into local memory. Text PDFs receive a PDF.js `TextLayer` positioned over the canvas, so browser selection and copying use the source text without changing the visual page. Image-only pages simply contribute no selectable spans.

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

- Unit tests cover PDF file recognition, display metadata, page constraints, zoom constraints, progress calculations, and Vim navigation deltas.
- HTTP tests cover the application shell, browser bundle, health endpoint, method boundary, and static-file containment.
- `bun run typecheck` covers server, browser, test, and repository-script TypeScript.
- Browser verification exercises the generated sample through the real PDF worker, canvas renderer, and responsive UI.

`bun run check` is the repository-wide local gate and also validates the agent-facing project structure.
