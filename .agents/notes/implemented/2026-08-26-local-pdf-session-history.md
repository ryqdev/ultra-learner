# Agent Note: Local PDF session history

Status: implemented

## Problem

Uploaded documents disappeared when the tab closed, so a learner could not return to PDFs they had previously opened. Browser storage is not a good fit for files up to the reader's 100 MB limit, and an external database or cloud service would weaken the application's local-first boundary and introduce accounts, synchronization, and retention policy before they are needed.

## Decision

Each successfully parsed user upload creates an immutable local session through the loopback Bun server. The default storage root is `~/.ultra-learner`; every session has an opaque ID and owns a directory under `sessions/` containing the original bytes as `document.pdf` and versioned `metadata.json`. Metadata records the ID, source filename, byte size, and creation time. The home screen lists valid sessions newest-first and retrieves the stored PDF through an ID-based endpoint when the learner reopens one. The generated sample remains ephemeral and does not enter history.

The browser continues to own PDF parsing and rendering. It validates the file at entry, keeps the original byte array for persistence, and gives PDF.js a copy because the worker may transfer its input buffer. Persistence starts only after PDF.js successfully opens the document, so rejected candidates do not leave history entries. The server validates size, filename, PDF header, opaque IDs, metadata, regular-file boundaries, and stored byte size. Incomplete or corrupt directories are ignored rather than breaking the whole history.

## Alternatives considered

**Use IndexedDB for PDF bytes.** This would keep the server read-only, but browser quotas and eviction behavior vary, large values are harder to inspect and back up, and the requested durable location is a user-visible home-directory folder.

**Store one mutable record per filename or content hash.** Deduplication would reduce repeated storage, but it would make repeat uploads cease to be distinct sessions and introduce overwrite or reference-counting semantics that the history does not need.

**Persist before parsing.** Writing immediately could avoid holding a second byte buffer, but invalid or unsupported PDFs would appear in history or require a deletion/rollback contract. Successful browser parsing is the acceptance boundary for a session.

**Add a database.** A database would support richer queries and mutable progress, annotations, or messages, but immutable metadata directories are sufficient for the current list-and-reopen behavior and remain easy to inspect and recover.

## Consequences

- Uploaded PDF bytes now cross the browser/server boundary, but remain on the same device under the local application's control; privacy copy and architecture documentation must describe that boundary accurately.
- Repeated uploads intentionally create separate sessions, even when filenames or bytes match.
- Disk use grows until a future deletion or retention feature is introduced.
- Reading position, zoom, chat messages, selections, provider credentials, and the sample document remain ephemeral.
- The version field gives future migrations an explicit compatibility boundary; unsupported, malformed, symlinked, incomplete, or size-mismatched entries are hidden from history.
