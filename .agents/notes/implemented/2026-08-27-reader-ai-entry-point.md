# Agent Note: Consolidated reader AI entry point

Status: implemented

## Problem

The document bar presented separate AI guide, new-conversation, and new-PDF actions even though the workspace sidebar and Library already owned conversation and file entry. The repeated actions crowded the reader header, while the AI panel repeated a decorative label and heading above its functional model control. Provider-form placeholders also looked too similar to entered values.

## Decision

The document bar initially reserved its far-right action for one visually distinct AI guide trigger. The trigger opened and closed the right-hand panel and mirrored its state through `aria-expanded`; the panel also retained a close control. New conversations remained available through the workspace sidebar, and new PDFs started from the Library's focused upload surface. The later [focused reader chrome](2026-08-28-focused-reader-chrome.md) decision removes the document bar and moves the AI trigger into the compact top strip while preserving the single-entry-point principle.

The panel removes its decorative eyebrow and title, placing the model summary and close control in one compact first row. Empty input and model/profile selector hints use a dedicated muted placeholder color in both reading themes, while actual values retain the normal text color.

## Alternatives considered

**Keep all three document-bar actions and only adjust spacing.** This would move the AI entry slightly but preserve competing controls and duplicate workflows already owned elsewhere.

**Use an unlabeled floating AI button.** A floating control would remain visible over the reading surface, but it could obscure PDF content and would be less self-explanatory than a labeled top-right action.

**Remove the panel close control and rely only on the document-bar trigger.** A single toggle would reduce one control, but a close action inside the panel is easier to discover and follows the panel's visual containment.

## Consequences

- The document bar had one clear right-aligned action and more room for long filenames until the focused reader chrome superseded the bar itself.
- Starting another conversation or choosing another file requires the workspace navigation rather than a duplicate reader shortcut.
- The model configuration begins closer to the top of the panel, leaving more vertical room for the conversation.
- Placeholder and entered-value states are easier to distinguish without changing the provider-profile data contract.
