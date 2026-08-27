# Agent Note: Focused library entry screen

Status: implemented

## Problem

The workspace sidebar duplicated the PDF entry point with an `Open PDF` action, while the home screen's decorative two-column treatment competed with the upload task. This made the first step less focused and left two visually different ways to begin a document.

## Decision

The sidebar now keeps only conversation and library navigation; PDF selection remains available from the focused home upload card and from the reader's `New PDF` control. The home screen uses a centered single-column layout, retains the drag-and-drop/file-picker card, sample guide link, local-storage explanation, and footer, and removes the large decorative page illustration.

## Alternatives considered

**Keep both PDF entry points.** This preserves shortcut discoverability, but repeats the same action in the navigation and primary workspace and keeps the sidebar visually busy.

**Keep the illustration and only hide the sidebar action.** This would address the duplicate control but would not make the requested landing screen more concise.

**Remove the sample guide and supporting copy.** This would shorten the screen further, but the sample is the only no-file demonstration path and the local-storage note communicates an important privacy boundary.

## Consequences

- New users see one clear PDF entry point when they are in the Library view.
- Existing reader behavior remains unchanged; `New PDF` still opens the file picker without requiring a return to the home screen.
- The home layout has fewer decorative elements and adapts as a single centered column across desktop and compact widths.
- The sidebar contract and architecture documentation now describe only the controls that are actually present.
