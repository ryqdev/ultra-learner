# Agent Note: Reuse the session of an identical upload

Status: implemented

## Problem

The [session history decision](2026-08-26-local-pdf-session-history.md) made every upload a new session, even when the name and bytes matched one already stored. Sessions hold nothing but the document, so the copies were indistinguishable in Recents apart from their timestamps, and each cost up to 100 MB. Opening the same textbook on five days stored it five times, and the only remedy was deleting the duplicates one by one.

## Decision

When an upload has the same filename and exactly the same bytes as a stored session, the store discards the upload and returns that session. The API answers `200` with the existing session rather than `201`, and the reader marks it as the open session and tells the learner the PDF is already in history. Identity is checked by comparing SHA-256 digests, computed only for stored sessions that already match on name and size, so a first upload costs a directory listing. The same bytes under a different name, or different bytes under the same name, remain separate sessions.

This supersedes the earlier consequence that repeated uploads intentionally create separate sessions.

## Alternatives considered

**Keep one session per upload.** This is the previous behavior. It avoids any identity rule, but the distinct sessions it preserves carry no distinct state, so the learner gains nothing for the disk they cost.

**Match on content alone and ignore the name.** That removes more duplicates, but a renamed copy would reopen under its old name, which reads as the application ignoring the file the learner picked.

**Store a content hash in the metadata.** Lookups would avoid rehashing stored files, at the price of a metadata format change and a migration for existing sessions. Hashing is limited to same-name, same-size candidates, which is rare enough not to need an index.

**Deduplicate storage but keep separate history entries.** Reference-counted blobs would save the disk while preserving every entry, but the earlier decision already rejected the overwrite and reference-counting semantics that requires, and the duplicate entries were themselves the clutter.

## Consequences

- Reopening a document does not grow `~/.ultra-learner` or add a Recents entry; the original entry keeps its creation time and position.
- A session is no longer a record of each time a file was opened. Nothing in the product relied on that.
- Deleting the session removes the only stored copy, as before; opening the file again afterwards stores it afresh.
- An upload that turns out to be a duplicate is still written to the incoming directory and hashed before it is discarded.
- Disk use still grows with the number of distinct documents until the learner deletes them; automatic retention remains out of scope.
