# Agent Note: Focused library entry screen

Status: implemented

## Problem

The workspace sidebar duplicated the PDF entry point with an `Open PDF` action, while the home screen's decorative two-column treatment competed with the upload task. This made the first step less focused and left two visually different ways to begin a document.

## Decision

The sidebar now keeps only conversation and library navigation; PDF selection remains available from the focused home upload card and from the reader's `New PDF` control. The home screen uses a centered single-column layout around the drag-and-drop/file-picker card and removes the decorative illustration, supporting marketing copy, sample guide entry, and status footers. The upload card remains the source of the file constraints and local-storage path.

## Alternatives considered

**Keep both PDF entry points.** This preserves shortcut discoverability, but repeats the same action in the navigation and primary workspace and keeps the sidebar visually busy.

**Keep the illustration and only hide the sidebar action.** This would address the duplicate control but would not make the requested landing screen more concise.

**Keep the sample guide, supporting copy, and status footers.** These elements explain the product and provide a no-file demonstration path, but they add repeated visual framing around the primary upload action. The upload card already communicates the local-storage boundary needed at the entry point.

## Consequences

- New users see one clear PDF entry point when they are in the Library view.
- Opening the bundled sample is no longer available from the interface.
- Existing reader behavior remains unchanged; `New PDF` still opens the file picker without requiring a return to the home screen.
- The home layout has fewer decorative and explanatory elements and adapts as a single centered column across desktop and compact widths.
- The sidebar contract and architecture documentation now describe only the controls that are actually present.
