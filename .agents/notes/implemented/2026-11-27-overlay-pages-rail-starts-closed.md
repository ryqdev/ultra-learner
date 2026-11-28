# Agent Note: Pages rail starts closed where it overlays the page

Status: implemented

## Problem

At 1180 pixels and below the Pages rail has no column of its own and lies over the reader. The [reader panel defaults](2026-08-31-reader-panel-defaults.md) decision opened it on every entry into reading mode, so on a tablet-width window each document appeared with its left edge behind the rail, and on a phone the rail hid more than half of the page. Between 761 and 1180 pixels the overlay also started at the top of the reader, where it covered the control strip's Library and thumbnail controls.

On phones the reader grid kept a column for the AI Guide whenever the rail was closed and the guide open, although the guide is an overlay there. The reading surface shrank to its minimum width and the guide extended past the right edge of the screen.

## Decision

The rail starts open only where it has a column of its own. `pagesRailStartsOpen` in `src/lib/layout.ts` owns that rule and uses the same 1180-pixel limit at which `public/styles.css` turns the rail into an overlay. At or below the limit, each entry into reading mode starts with the rail closed. The AI Guide still starts closed at every width.

An overlaying rail begins under the control strip at every compact width, so it never covers the strip's controls. On phones no combination of panel states gives a panel a grid column.

A document that fails to open closes the rail at any width, because it has no pages to list. A closed rail is also hidden from the tab order once it has slid away.

## Alternatives considered

**Keep the open default and only move the overlay under the control strip.** The strip's controls would be reachable again, but every document would still open with part of its first page covered, and the learner would have to dismiss the rail before reading.

**Close an overlaying rail when a page is chosen from it.** The chosen page would always be fully visible, but looking through several thumbnails in a row would mean reopening the rail each time. The toolbar toggle, the rail's close button, and Escape already dismiss it.

## Consequences

- On a wide window the reader opens as before, with page navigation visible.
- On a tablet-width or phone-width window the page is fully visible first, and thumbnails are one action away.
- The 1180-pixel limit is written in both the stylesheet and `src/lib/layout.ts`. Changing one requires changing the other.
- The starting state follows the window width when a document opens. Resizing the window afterwards leaves the rail as it is.
