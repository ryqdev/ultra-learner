# Agent Note: Focused reader chrome

Status: implemented

## Problem

The reader stacked a global title bar, a document title bar, and a sixty-pixel toolbar around the PDF. Its thumbnail rail also opened by default, while the AI guide used a prominent model card, decorative empty state, suggestion chips, explanatory setup copy, and a tall composer. Together these controls reduced the page area and gave secondary windows the same visual weight as the document.

## Decision

Reading mode hides the global workspace navigation and top bar, removes the document bar, and starts with the thumbnail rail closed. A forty-pixel top strip becomes the single control surface: it keeps icon-only Library, thumbnail, selection, fit, and AI actions around the compact page and zoom controls. The document filename and reading progress remain available to assistive technology without taking visible space.

The AI guide remains available beside the PDF, but its default surface is limited to a plain model selector row, the conversation, and an integrated composer. The empty state uses one heading and one sentence; decorative marks, suggestion chips, setup introductions, and privacy footers are removed. Detailed provider fields appear only when the learner expands model setup. This decision supersedes the document-bar placement in [the earlier AI entry-point note](2026-08-27-reader-ai-entry-point.md). The later [model-configuration-only guide decision](2026-08-31-model-configuration-only-guide.md) supersedes the conversation, collapsed-setup, and AI selection-control portions of this decision.

## Alternatives considered

**Keep one of the two title bars.** A filename can help orientation, but the browser title and Library history already retain it, while a permanent bar consumes height on every page.

**Float controls over the document stage.** Floating controls would preserve the full stage height, but they could obscure PDF content and make the reader less predictable at high zoom.

**Remove thumbnails and the AI guide entirely.** This would maximize the PDF area but discard useful navigation and study capabilities. Keeping both on demand preserves the focused default without removing functionality.

## Consequences

- Reading mode devotes the full viewport to the PDF, its on-demand side panels, and one compact control strip.
- Returning to the Library is explicit from the top-left control because the workspace navigation is absent while reading.
- Thumbnail navigation requires one extra action on every viewport size.
- Model setup is denser and relies on field labels and status messages rather than explanatory cards.
- Very narrow layouts progressively remove visible selection and secondary zoom controls while retaining page navigation and the AI entry point.
