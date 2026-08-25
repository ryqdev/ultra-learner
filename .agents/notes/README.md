# Agent Notes

Agent Notes are lightweight decision records written for both humans and coding agents. They preserve information that source code and current-state documentation cannot: why a decision won, what alternatives lost, and which costs were accepted.

## Lifecycle

The first directory under `notes/` is the decision status:

- `proposed/`: a substantial proposal that has not shipped.
- `implemented/`: the decision describes current shipped reality.
- `rejected/`: a considered proposal that was deliberately declined.

Create lifecycle directories only when they contain a note. Add category subdirectories later only if the number of notes makes them useful.

Files use `yyyy-mm-dd-short-topic.md`, where the date is when the decision was first proposed.

## When to write one

Add or update a note when a change alters behavior, architecture, a cross-file contract, the development process, testing strategy, or a persisted/configuration format. Updating the note that already owns the decision is preferable to creating a duplicate.

Do not add a note for formatting, spelling, a local rename, or another mechanical edit with no change in behavior, structure, process, or rationale.

## Format

All notes begin with:

```markdown
# Agent Note: <title>

Status: <proposed|implemented|rejected — reason>
```

Required sections:

- Proposed: `Problem`, `Proposal`, `Alternatives considered`, `Acceptance criteria`, `Risks`.
- Implemented: `Problem`, `Decision`, `Alternatives considered`, `Consequences`.
- Rejected: `Problem`, `Proposal`, `Alternatives considered`.

Write from the repository's perspective. Record current decisions and durable rationale, not prompts, review choreography, or a chronological reasoning transcript. Moving a note between lifecycle directories also updates its status and section structure.

`bun run check` validates filenames, status, required sections, and compatibility symlinks.
