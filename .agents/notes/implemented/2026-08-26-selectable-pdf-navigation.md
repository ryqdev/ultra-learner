# Agent Note: Selectable PDF text and keyboard navigation

Status: implemented

## Problem

The reader displayed each PDF page only as a canvas, so text PDFs could not be selected or copied. The page rail also needed a reliable independent scroll area, and focused reading required fast page and viewport navigation without reaching for the mouse.

## Decision

The browser reader overlays PDF.js `TextLayer` on the existing canvas using the same viewport and scale. The layer remains visually transparent while its positioned spans provide native browser text selection. The thumbnail rail is a constrained flex child with explicit vertical overflow, so its scroll position is independent of the document stage. The existing current-page input remains the page-jump control and is labelled with its total page count. Vim-style navigation is handled at the application boundary: `j`/`k` scroll the reader stage by a fixed 140-pixel step and turn to the next or previous page when the corresponding edge is reached, while `d`/`u` move one page directly; editable fields and modifier-key shortcuts are excluded.

## Alternatives considered

**Render extracted text as a separate document below the canvas.** That would make text accessible but would lose the PDF's exact positional mapping and make selection visually misleading.

**Use PDF.js's full viewer component.** It supplies text selection and navigation, but would replace the repository-owned reader layout and introduce a larger integration surface than this focused change needs.

**Bind Vim keys globally without target checks.** This is shorter, but it would hijack page-number entry, provider forms, and text-area editing.

## Consequences

- Text-based PDFs support native selection and copy while image-only PDFs continue to render normally.
- Text-layer rendering adds asynchronous work per page and is cancelled when navigation or document replacement starts.
- Thumbnail scrolling and keyboard navigation, including edge-triggered page turns, are deterministic and covered by helper tests; browser layout and selection still require a real browser check when one is available.
- The selection layer is intentionally presentation-transparent, so PDF visual fidelity remains owned by the canvas.
