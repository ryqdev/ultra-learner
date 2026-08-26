# Ultra Learner

Ultra Learner is a calm, local-first PDF reader built with Bun and TypeScript. It gives a learner a focused place to open a document, browse page thumbnails, move between pages, and adjust the reading scale without sending the file to a server. A right-hand study companion can connect to any OpenAI-compatible chat endpoint and use text or box selections from the current PDF page as grounded context.

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
- Browser-only PDF parsing; selected documents are not posted to the Bun server.
- Scrollable page thumbnails, previous/next controls, direct page entry with a visible page count, reading progress, and Vim-friendly keyboard navigation (`j`/`k` scroll, `d`/`u` page).
- Native text selection and copying for PDFs that contain a text layer; scanned/image-only pages continue to render through the canvas.
- Zoom controls, fit-to-page behavior, responsive layouts, and a dark reading theme.
- A selectable PDF.js text layer, box selection mode, and a synchronized AI study companion panel.
- Session-only provider settings for API key, Base URL, and model; credentials are never sent to the Bun server.
- Friendly loading, invalid-file, empty-file, and rendering error states.
- A generated sample PDF that exercises the same reader path as uploaded documents.

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
src/server.ts       Bun HTTP server and browser bundle endpoint.
src/web/            Reader, selection, chat-panel UI, and generated sample document.
src/lib/            Deterministic file, reader, selection, and chat-transport helpers.
test/               Behavior and HTTP boundary tests.
docs/               Stable architecture guidance.
.agents/            Project decisions and reusable agent workflows.
```

See [`docs/architecture.md`](docs/architecture.md) for the product boundaries and [`AGENTS.md`](AGENTS.md) for the repository working agreement.
