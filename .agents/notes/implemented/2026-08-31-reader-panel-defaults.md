# Agent Note: Reader panel defaults

Status: implemented

## Problem

The reader opened model configuration beside every PDF while keeping page thumbnails hidden. This prioritized occasional setup over the document navigation learners use throughout a reading session.

## Decision

Each entry into reading mode starts with the Pages rail open and the AI Guide closed. The toolbar controls continue to toggle both panels, and the AI trigger's accessible state matches the closed guide before browser code runs.

This decision supersedes the closed-thumbnail default in [the focused reader chrome decision](2026-08-28-focused-reader-chrome.md). It does not change the model configuration workflow itself.

## Alternatives considered

**Preserve panel state between documents.** Remembering manual changes would reduce repeated toggles, but a prior document's layout would make the next document's starting state unpredictable.

**Start with both panels closed.** This would maximize the PDF surface, but it would keep page navigation one action away while hiding the less frequently used configuration equally well.

## Consequences

- Page thumbnails are immediately visible when a PDF opens.
- Model configuration requires an explicit toolbar action and does not consume the initial reading area.
- Opening another PDF restores these defaults after either panel has been toggled.
- On narrower layouts, the initially open Pages rail uses its existing overlay behavior.
