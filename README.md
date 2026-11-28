# Ultra Learner

Ultra Learner is a calm, local-first PDF reader built with Bun and TypeScript. It gives a learner a focused place to open a document, browse page thumbnails, move between pages, and adjust the reading scale. Uploaded PDFs are retained by the local Bun process in `~/.ultra-learner`, or the directory given with `--data-dir`, so they can be reopened from the reading history. A right-hand AI Guide stores reusable OpenAI-compatible model settings for future learning features.

This is the first product prototype.

## Try it

Requires [Bun](https://bun.sh/) 1.3 or newer.

After the [first npm release](docs/releasing.md#first-publish-and-trusted-publisher-setup):

```sh
bunx @ryqdev/ultra-learner
```

Open the printed URL in your browser. Use `--port 4100` to choose a port,
`--data-dir <path>` (or `ULTRA_LEARNER_HOME`) to keep sessions somewhere other
than `~/.ultra-learner`, `--help` for usage, or `--version` to check the
installed version. The server listens on `127.0.0.1` and only answers requests
addressed to `127.0.0.1`, `localhost`, or `[::1]`; pass `--allow-host <host>`
when a forwarding proxy presents another host name. The package requires Bun at
runtime. Use `bunx @ryqdev/ultra-learner@latest` to request the latest release,
or specify a version to reproduce an older release.

To run from a repository checkout:

```sh
bun install
bun run start
```

Open `http://127.0.0.1:8881`, then drop in a PDF or choose one from the device.

For development with automatic server restarts:

```sh
bun run dev
```

`bun run dev` sets `NODE_ENV=development`, which rebuilds the unminified browser
bundle on every request so edits under `src/web/` appear on reload. Every other
start builds a minified bundle once and keeps it in memory.

## Self-hosting

To open one library from several of your devices, run the reader on a server
behind a gateway that authenticates visitors and terminates HTTPS, such as
Tailscale Serve or Caddy with an authentication service. The reader has no
accounts, so anyone who reaches it directly can read and delete every saved PDF.
[Self-hosting](docs/deployment.md) covers the supported setups, `--host`, proxy
limits, a systemd unit, backups, and what changes for a self-hosted reader.

## Current experience

- Drag-and-drop and file-picker entry points for PDFs up to 100 MB.
- A workspace sidebar with a local reading history: each uploaded PDF becomes a session in `~/.ultra-learner/sessions` and can be reopened or explicitly deleted from the persistent Recents list. Opening a PDF that is already stored under the same name reuses its session instead of saving another copy, and a reopened session returns to the page where it was left.
- Browser-owned PDF parsing and rendering; the Bun server only receives uploaded bytes to persist them on the same device, streaming them to disk and making a session visible only once it is complete.
- On-demand page thumbnails, previous/next controls, direct page entry with a visible page count, and Vim-friendly keyboard navigation (`j`/`k` scroll and continue onto the adjoining page at either edge, `d`/`u` page).
- Native text selection and copying for PDFs that contain a text layer; scanned/image-only pages continue to render through the canvas.
- Clickable PDF links and form controls, including table-of-contents destinations, cross-page navigation, external URLs, and embedded attachments.
- Zoom controls that keep the current reading position, fit-to-page behavior, responsive layouts, and a dark reading theme that follows the system setting until one is chosen, is remembered across visits, and can be switched while reading.
- A model-configuration-only AI Guide with common hosted/local presets, API-key visibility control, model discovery, reasoning-level selection, connection testing, and profiles that take an optional name and otherwise follow their model. Profiles are stored in this browser's origin-local storage and can be reused across PDF sessions on the same device. The reader does not currently expose a prompt or send PDF content to a model.
- Friendly loading, invalid-file, empty-file, and rendering error states.

## Commands

```sh
bun run start       # Start the local application on port 8881.
bun run dev         # Start in development mode with Bun watch mode.
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
src/web/            Reader, history, and model-configuration UI.
src/lib/            Deterministic file, session, reader, model-request, provider-profile, and theme helpers.
test/               Behavior and HTTP boundary tests.
docs/               Stable architecture and self-hosting guidance.
.agents/            Project decisions and reusable agent workflows.
```

See [`docs/architecture.md`](docs/architecture.md) for the product boundaries and
the repository's [AGENTS.md](https://github.com/ryqdev/ultra-learner/blob/main/AGENTS.md)
for the working agreement.

See [Releasing to npm](docs/releasing.md) for release PRs, version rules,
Trusted Publisher setup, and publishing retries.

## License

[MIT](LICENSE). PDF.js is distributed separately under its own license.
