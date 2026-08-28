# Agent Note: Selectable PDF text and keyboard navigation

Status: implemented

## Problem

The reader displayed each PDF page only as a canvas, so text PDFs could not be selected or copied. The page rail also needed a reliable independent scroll area, and focused reading required fast page and viewport navigation without reaching for the mouse.

## Decision

The browser reader overlays PDF.js's `TextLayerBuilder` on the existing canvas using the same viewport and scale. The builder supplies the `.endOfContent` anchor and browser-specific selection repair that keeps a drag selection from expanding into the blank margin or the whole page. The layer remains visually transparent while its positioned spans provide native browser text selection. The thumbnail rail is a constrained flex child with explicit vertical overflow, so its scroll position is independent of the document stage. The reader shell assigns the page rail, main surface, and AI guide to explicit grid columns, keeping the latter two anchored when a responsive breakpoint removes the absolutely positioned page rail from grid flow. The existing current-page input remains the page-jump control and is labelled with its total page count. Vim-style navigation is handled at the application boundary: `j`/`k` scroll the reader stage by a fixed 140-pixel step and turn to the next or previous page when the corresponding edge is reached, while `d`/`u` move one page directly; editable fields and modifier-key shortcuts are excluded. Browser zoom shortcuts remain native so `Command`/`Control` with `+` or `-` scales the whole application, while PDF-only zoom stays on the reader toolbar. The desktop toolbar lays out its keyboard shortcut hint and reading-progress indicator in one right-side flex group so their variable widths cannot overlap. Compact toolbars return selection controls to normal flex flow and hide the secondary status group before controls can collide.

## Alternatives considered

**Render extracted text as a separate document below the canvas.** That would make text accessible but would lose the PDF's exact positional mapping and make selection visually misleading.

**Use PDF.js's full viewer component.** It supplies text selection and navigation, but would replace the repository-owned reader layout and introduce a larger integration surface than this focused change needs.

**Bind Vim keys globally without target checks.** This is shorter, but it would hijack page-number entry, provider forms, and text-area editing.

## Consequences

- Text-based PDFs support native selection and copy while image-only PDFs continue to render normally.
- Text-layer rendering adds asynchronous work per page and is cancelled when navigation or document replacement starts.
- Thumbnail scrolling and keyboard navigation, including edge-triggered page turns, are deterministic and covered by helper tests; browser layout and selection still require a real browser check when one is available.
- The selection layer is intentionally presentation-transparent, so PDF visual fidelity remains owned by the canvas; PDF.js's selection anchor and repair listener keep native drag selection bounded to the intended text.
- The right-side toolbar status group keeps shortcut and progress text legible as either label changes; compact breakpoints continue to hide the progress indicator and shortcut hint when space is limited.
- Responsive page-rail overlays do not shift the reader or AI guide into the wrong grid column.
- Compact toolbar controls remain separate instead of sharing the same absolute position.
