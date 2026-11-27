# Agent Note: Remember the last page of each session

Status: implemented

## Problem

A session stored the document and nothing about reading it, so every reopen started at page one. For the long documents a learner returns to over days, finding the place again was the first task of each sitting. The [session history decision](2026-08-26-local-pdf-session-history.md) left reading position ephemeral because its immutable metadata directories had no place for state that changes.

## Decision

Each session may carry a `progress.json` beside its metadata, holding a format version and the one-based page last shown. `PUT /api/sessions/<id>/progress` replaces it, writing a temporary file and renaming it so a concurrent read never sees a partial value. Session summaries expose the value as an optional `lastPage`; a missing, unreadable, or unsupported file means the document opens at its first page.

The browser reports the page 400 ms after page turns settle, and immediately when the learner returns to the Library, opens another document, or closes the tab, using a keep-alive request so the last one survives the page. It writes only when the page differs from the stored one. Because those requests are not awaited, each carries a `writer` chosen per page load and an increasing `sequence`; the store applies one session's updates one at a time and drops an update numbered lower than one it has already applied from the same writer, so a request that left earlier but arrived later cannot put the position back. A sequence only orders one page load. Each update therefore also carries the time it was recorded, and for ten seconds after an update is applied, one from a different writer that was recorded earlier is dropped as well: that is a closing tab's last write overtaken by the tab that replaced it. Opening a session starts at its `lastPage`, clamped to the document. An upload that [reuses a stored session](2026-11-26-reuse-identical-uploads.md) resumes at that session's page unless the learner has already moved off page one.

This supersedes the earlier consequence that reading position remains ephemeral. Zoom, scroll offset within a page, and panel state remain ephemeral.

## Alternatives considered

**Add the page to `metadata.json`.** One file per session is simpler, but it would make the record of the upload mutable, rewrite it on every page turn, and risk the session itself if a write were interrupted. A separate file keeps a damaged position harmless.

**Keep the position in browser storage.** No server route would be needed, but it would be tied to the origin, so starting the reader on another port would lose every position while the documents themselves remained. The position belongs with the document it describes.

**Save on every page turn.** Simpler than debouncing, but paging quickly through a document would issue a write per page for values that are immediately obsolete.

**Make the browser wait for each write before sending the next.** Ordering would then need nothing from the server, but the last write is sent while the tab is closing, when there is no time to wait for an earlier one. Numbering the updates orders them wherever they meet.

**Store scroll offset and zoom as well.** A fuller restore, but both depend on window size and layout, so a stored value would often be wrong on return. The page is the stable part of a position.

## Consequences

- Reopening a document returns to the page where it was left, across restarts and across ports.
- Session directories now contain one small file that changes; `metadata.json` and `document.pdf` are still never rewritten.
- Deleting a session removes its position with it. The delete waits for that session's pending position writes and later ones find no session, so the two never work on the directory at once.
- A failed position save is silent: it never interrupts reading, and the cost is reopening one page off.
- Comparing recorded times trusts the writers' clocks, which on one device is the same clock. The ten-second limit keeps a device whose clock runs behind from being shut out for longer than that after another device's update.
- The applied sequence numbers live in the server's memory. After a restart the first update from any writer is applied, which is correct because no earlier request can still be in flight.
- A summary whose `lastPage` is not a usable page number is read as having none; the session stays listed.
- The session API gains a fifth operation, protected like the others by host validation and by the browser's preflight for a JSON `PUT`.
