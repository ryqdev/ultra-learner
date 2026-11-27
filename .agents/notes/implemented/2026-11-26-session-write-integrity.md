# Agent Note: Session write integrity

Status: implemented

## Problem

Saving an upload created the session directory first, then wrote the PDF, then wrote the metadata. A process killed between those steps left a directory holding up to 100 MB that history never listed, because it had no valid metadata, and that the delete endpoint refused for the same reason. Nothing ever reclaimed it.

The upload also existed several times in memory. The browser kept the file's bytes beside the copy handed to PDF.js and wrapped them again for the request, while the server collected the whole body into chunks and then concatenated them before writing.

## Decision

The store writes each upload into a private `sessions/.incoming-<uuid>/` directory, adds the metadata there, and renames the directory to its session ID as the last step. A session directory therefore either does not exist or is complete. The leading dot keeps an upload in progress from ever matching the session ID pattern.

The store accepts the request body as a stream and writes it to disk as it arrives, enforcing the size limit and checking the PDF header on the first kilobyte while it writes. The browser uploads the original `File` after PDF.js has parsed the document, instead of retaining a second copy of its bytes.

On its first use after start, the store removes two kinds of leftovers once they are more than an hour old: incoming directories, and session-ID directories that contain nothing but an optional `document.pdf`, which is the state the previous write order could be interrupted in. The age limit protects an upload still being written by another running reader. Directories that hold a `metadata.json`, even an unreadable one, and directories with any other content are left alone, except that a reading-position draft (`progress.json.*.tmp`) older than an hour is removed from them: it is what a position write leaves when it is cut off before its rename.

## Alternatives considered

**Write the metadata before the document.** This makes the half-written state visible to validation, since the stored size would not match, but the directory still exists, still cannot be deleted through the interface, and still needs a cleanup rule.

**Let the delete endpoint remove directories without valid metadata.** History omits those directories, so the interface has no control that could call it.

**Remove every malformed session directory.** A directory with unrecognized metadata may belong to a newer version of the reader; deleting it would turn a downgrade into data loss. Cleanup is limited to the one shape that can only be an interrupted write.

**Keep buffering the upload.** Simpler to validate, but peak memory was roughly twice the document on the server and three times on the browser at the 100 MB limit.

## Consequences

- An interrupted upload leaves at most a stale incoming directory, which the next start clears after the grace period.
- Space taken by directories orphaned under the previous write order is reclaimed automatically; this is the only automatic removal, and it never touches a session that history could show.
- A non-PDF upload is rejected after its first kilobyte instead of after its last.
- Server memory during an upload is bounded by the stream's chunk size, and the browser holds one copy of the document, the one PDF.js owns.
- Persistence still starts only after PDF.js opens the document, as [the session history decision](2026-08-26-local-pdf-session-history.md) requires; the browser reads the file a second time for the upload rather than keeping its bytes.
