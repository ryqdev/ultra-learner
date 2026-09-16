# Ultra Learner

Ultra Learner is a calm, local-first PDF reader built with Bun and TypeScript. It gives a learner a focused place to open a document, browse page thumbnails, move between pages, and adjust the reading scale. Uploaded PDFs are retained by the local Bun process in `~/.ultra-learner` so they can be reopened from the reading history. A right-hand AI Guide stores reusable OpenAI-compatible model settings for future learning features.

This is the first product prototype. It includes a built-in four-page field guide so the complete reading experience can be explored without finding a PDF first.

## Try it

Requires [Bun](https://bun.sh/) 1.3 or newer.

After the first npm release:

```sh
bunx @ryqdev/ultra-learner
```

Open the printed URL in your browser. Use `--port 4100` to choose a port,
`--help` for usage, or `--version` to check the installed version. The package
requires Bun at runtime. Use `bunx @ryqdev/ultra-learner@latest` to request the
latest release, or specify a version to reproduce an older release.

To run from a repository checkout:

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
- A workspace sidebar with a local reading history: each uploaded PDF becomes a session in `~/.ultra-learner/sessions` and can be reopened or explicitly deleted from the persistent Recents list.
- Browser-owned PDF parsing and rendering; the Bun server only receives uploaded bytes to persist them on the same device.
- On-demand page thumbnails, previous/next controls, direct page entry with a visible page count, and Vim-friendly keyboard navigation (`j`/`k` scroll and turn the page at the matching edge, `d`/`u` page).
- Native text selection and copying for PDFs that contain a text layer; scanned/image-only pages continue to render through the canvas.
- Clickable PDF links and form controls, including table-of-contents destinations, cross-page navigation, external URLs, and embedded attachments.
- Zoom controls, fit-to-page behavior, responsive layouts, and a dark reading theme.
- A model-configuration-only AI Guide with common hosted/local presets, API-key visibility control, model discovery, reasoning-level selection, connection testing, and named profiles. Profiles are stored in this browser's origin-local storage and can be reused across PDF sessions on the same device. The reader does not currently expose a prompt or send PDF content to a model.
- Friendly loading, invalid-file, empty-file, and rendering error states.
- A generated sample PDF with cross-page links that exercises the same reader path as uploaded documents.

## Commands

```sh
bun run start       # Start the local application on port 8881.
bun run dev         # Start with Bun watch mode.
bun test            # Run behavior and server tests.
bun run typecheck   # Check TypeScript without emitting files.
bun run check       # Run every required local gate.
bun run test:package # Pack and test a clean consumer installation (requires network).
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
src/web/            Reader, history, model-configuration UI, and generated sample document.
src/lib/            Deterministic file, session, reader, selection, chat transport, and provider-profile helpers.
test/               Behavior and HTTP boundary tests.
docs/               Stable architecture guidance.
.agents/            Project decisions and reusable agent workflows.
```

See [`docs/architecture.md`](docs/architecture.md) for the product boundaries and
the repository's [AGENTS.md](https://github.com/ryqdev/ultra-learner/blob/main/AGENTS.md)
for the working agreement.

Maintainers: see [the release guide](https://github.com/ryqdev/ultra-learner/blob/main/docs/releasing.md)
for release PRs, first-publication setup, and upload retries.

## License

[MIT](LICENSE). PDF.js is distributed separately under its own license.
