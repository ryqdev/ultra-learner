# Agent Note: Local-first PDF reader architecture

Status: implemented

## Problem

The repository needs an initial product that lets a learner open and comfortably browse a PDF on the web. PDF decoding is too complex and security-sensitive to implement as application-specific parsing code, while sending documents to a backend would add privacy, storage, cleanup, and authentication concerns before any server-side feature needs the bytes. The interaction model is also early enough that adopting a full UI framework would establish costly conventions without proven component or routing requirements.

## Decision

The first Ultra Learner product is a single-process Bun application with a local-first browser reader. Bun serves the static shell, bundles the TypeScript browser entry on request, and provides the PDF.js worker assets. PDF.js is the sole runtime dependency and parses selected file bytes in a web worker. The initial reader kept selected documents only in browser memory; the later [local PDF session history](2026-08-26-local-pdf-session-history.md) decision supersedes that ephemeral document boundary while retaining browser-owned parsing and rendering.

The reader renders one main canvas page at a time and generates a thumbnail rail for navigation. Page changes render the next canvas, text, and annotation layers off-screen before replacing the displayed page as one unit, so the current page remains visible instead of flashing an empty loading view. Main-page work cancels and takes priority over idle-scheduled thumbnail rendering. A delayed, text-free spinner appears over the current page only when a render is not fast enough to complete within the short transition threshold. Deterministic page, zoom, progress, filename, and file-validation rules live outside the DOM layer so tests can describe behavior without duplicating rendering implementation. Repository-owned HTML and CSS define the responsive interface without a UI framework.

After a selected file passes local type and size validation, the reader switches views immediately and exposes the existing loading state while the browser reads the file and PDF.js parses it. Invalid candidates do not force a view transition, so a validation toast cannot strand the user in an empty reader.

A small sample PDF is generated in browser memory and passed through the same loading and rendering path as a user-selected document. This makes the initial experience immediately inspectable while avoiding a binary sample fixture and preventing the demo from drifting into a separate mock implementation.

## Alternatives considered

**Use the browser's embedded PDF viewer.** An `<iframe>` or object URL would require much less code, but controls and rendering vary by browser and cannot support a coherent learning-focused interface or reliable thumbnail and progress behavior.

**Upload PDFs to Bun and render on the server.** Central parsing could support future indexing and cross-device persistence, but it would introduce document retention, request limits, security hardening, and privacy disclosures without serving a current requirement.

**Implement the PDF format directly.** Avoiding a dependency would preserve the original starter's dependency-free shape, but reliable support for fonts, images, page trees, compression, encryption, and malformed documents is far more complexity and risk than the application should own.

**Adopt a component framework and production bundler.** A framework could help once the reader grows into routing, shared state, and a design system. The current screen and interaction model fit explicit DOM code, and Bun already supplies the necessary TypeScript bundling and server runtime.

**Store a sample PDF binary in the repository.** A fixture would be easy to open but harder to inspect, adjust, and attribute. Generating a small standards-compliant document keeps the demonstration source-owned and exercises the production reader path.

## Consequences

- Users can inspect the full reading experience immediately and can open their own PDF without creating an account; user uploads now pass through the loopback application server for the local persistence defined by the session-history decision.
- PDF.js and its worker become versioned runtime assets and Bun now owns a dependency lockfile.
- Large documents still occupy browser memory, thumbnail generation remains sequential but yields to main-page work, and the 100 MB interface limit bounds the first prototype rather than guaranteeing smooth rendering at that size.
- Annotations, full-text search, password entry, and server-side learning features remain future product decisions; session persistence is now owned by the later session-history note.
- The UI remains easy to replace or componentize after real usage reveals stable boundaries, but explicit DOM event wiring will become less attractive as interaction complexity grows.
