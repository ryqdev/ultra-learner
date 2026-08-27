# Ultra Learner

Ultra Learner is a calm, local-first PDF reader built with Bun and TypeScript. It gives a learner a focused place to open a document, browse page thumbnails, move between pages, and adjust the reading scale. Uploaded PDFs are retained by the local Bun process in `~/.ultra-learner` so they can be reopened from the reading history. A right-hand study companion can connect to any OpenAI-compatible chat endpoint and use text or box selections from the current PDF page as grounded context.

This is the first product prototype. It includes a built-in four-page field guide so the complete reading experience can be explored without finding a PDF first.

## Try it

Requires [Bun](https://bun.sh/) 1.3 or newer.

```sh
bun install
bun run start
```

Open `http://127.0.0.1:8881`, then drop in a PDF, choose one from the device, or open the sample field guide.

For development with automatic server restarts:

```sh
bun run dev
```

## Current experience

- Drag-and-drop and file-picker entry points for PDFs up to 100 MB.
- A ChatGPT-style workspace sidebar with a local reading history: each uploaded PDF becomes a session in `~/.ultra-learner/sessions` and can be reopened or explicitly deleted from the persistent Recents list.
- Browser-owned PDF parsing and rendering; the Bun server only receives uploaded bytes to persist them on the same device.
- Scrollable page thumbnails, previous/next controls, direct page entry with a visible page count, reading progress, and Vim-friendly keyboard navigation (`j`/`k` scroll and turn the page at the matching edge, `d`/`u` page).
- Native text selection and copying for PDFs that contain a text layer; scanned/image-only pages continue to render through the canvas.
- Clickable PDF links and form controls, including table-of-contents destinations, cross-page navigation, external URLs, and embedded attachments.
- Zoom controls, fit-to-page behavior, responsive layouts, and a dark reading theme.
- A selectable PDF.js text layer, box selection mode, and a synchronized AI study companion panel.
- A guided provider setup with common hosted/local presets, inline endpoint help, API-key visibility control, and named model profiles. After entering an API key and Base URL, use Fetch models to load the provider's model catalog and any advertised reasoning levels; model and reasoning choices are selected from those results instead of typed manually. Model discovery, connection tests, and chat calls go through the same-origin Bun proxy, so providers do not need browser CORS support. Profiles are stored in this browser's origin-local storage and can be selected across PDF and conversation sessions on the same device; the API key is only forwarded to the configured provider through the local proxy.
- The workspace's New chat action starts a fresh AI conversation for the currently open PDF while keeping the document and provider settings in place.
- Friendly loading, invalid-file, empty-file, and rendering error states.
- A generated sample PDF with cross-page links that exercises the same reader path as uploaded documents.

## Commands

```sh
bun run start       # Start the local application on port 8881.
bun run dev         # Start with Bun watch mode.
bun test            # Run behavior and server tests.
bun run typecheck   # Check TypeScript without emitting files.
bun run check       # Run every required local gate.
```

Set `PORT` to use another port:

```sh
PORT=4100 bun run start
```

## Project layout

```text
public/             HTML and visual styles.
src/index.ts        Application entry point.
src/server.ts       Bun HTTP server, session API, and browser bundle endpoint.
src/session-store.ts Local PDF session persistence.
src/web/            Reader, history, selection, chat-panel UI, and generated sample document.
src/lib/            Deterministic file, session, reader, selection, chat transport, and provider-profile helpers.
test/               Behavior and HTTP boundary tests.
docs/               Stable architecture guidance.
.agents/            Project decisions and reusable agent workflows.
```

See [`docs/architecture.md`](docs/architecture.md) for the product boundaries and [`AGENTS.md`](AGENTS.md) for the repository working agreement.
