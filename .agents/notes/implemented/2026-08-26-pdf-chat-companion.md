# Agent Note: Decoupled PDF chat companion

Status: implemented

## Problem

The reader needed a conversational study surface beside the PDF without coupling provider credentials, network transport, selection mechanics, and PDF.js rendering into one browser entry file. A canvas-only page also could not provide a reliable relationship between a passage selected in the document and a question sent to a model.

## Decision

The browser composition root wires three explicit boundaries: `PdfReaderController` owns PDF.js and emits a provider-neutral `SelectionContext`; `ChatPanelController` owns provider configuration, conversation state, and chat UI; and pure helpers in `src/lib/chat.ts` and `src/lib/selection.ts` validate inputs and construct deterministic contracts. The reader overlays PDF.js `TextLayer` on the canvas for native text selection and offers a pointer-based box mode that resolves intersecting text runs into the same context shape. Chat requests use an OpenAI-compatible, non-streaming `/chat/completions` endpoint configured by the user. API keys and conversation state remain in tab memory only.

The desktop guide occupies a bounded, resizable grid track. A separator on its left edge supports pointer dragging and keyboard adjustment, while a deterministic layout helper reserves enough width for the main reader. The chosen width lasts for the current tab only, matching the rest of the browser-owned reading state; compact layouts retain a fixed overlay width.

## Alternatives considered

**Proxy model calls through Bun.** A server proxy would hide keys and enable centralized policy, but it would require a credential/session boundary and would make the local-first prototype responsible for secrets and provider uptime.

**Let the chat module inspect PDF.js DOM nodes directly.** This would be quicker initially, but it would make the panel depend on renderer implementation details and make future readers or selection sources harder to add.

**Use a provider SDK.** A dependency-specific SDK would narrow the first integration to one vendor and add lifecycle/version coupling. The common HTTP contract is enough for the requested configuration surface and keeps the runtime small.

**Persist the guide width in browser storage.** Remembering the preference across visits would be convenient, but this prototype deliberately keeps reader state ephemeral and currently has no broader preferences contract.

**Send the whole PDF or page image with every prompt.** That would increase privacy exposure, payload size, and provider cost. The interaction deliberately sends only the user-selected normalized excerpt.

## Consequences

- The reader and chat panel can evolve independently through a small selection event contract.
- Users can configure OpenAI-compatible hosted or local gateways without a backend route.
- Credentials disappear on reload and are never written to repository or server state; a future persistent experience will need an explicit secure credential design.
- Non-text/image-only PDF regions cannot produce text context in the current box mode and need OCR or multimodal work later.
- The browser owns CORS compatibility with the configured provider; gateways must allow requests from the application origin.
- Resizing the guide can change the PDF fit scale, so the composition root explicitly asks the reader to recalculate its layout when adjustment ends.
