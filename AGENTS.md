# AGENTS.md

This repository is a minimal AI-native development starter. Its agent layer keeps project instructions, durable decisions, reusable workflows, and executable verification beside the code.

## Repository layout

```text
src/                 Product code.
test/                Behavior tests using Bun's built-in test runner.
docs/                Current architecture and stable human-facing guidance.
.agents/notes/       Rationale and trade-offs for non-trivial decisions.
.agents/skills/      Reusable, progressively disclosed agent workflows.
scripts/             Repository checks invoked by the top-level gate.
```

## Commands

```sh
bun run start -- <name>  # Run the example CLI.
bun test                  # Run behavior tests.
bun run check             # Run every required local gate.
```

Use Bun 1.3 or newer exclusively for dependency management, scripts, and tests. Do not create lockfiles or use commands from another package manager. The starter has no third-party runtime dependencies; Bun creates `bun.lock` when dependencies are added.

## Working agreement

1. Read this file, the files in scope, and any Agent Note that owns the relevant decision before editing.
2. Make the smallest coherent change that satisfies the request. Preserve unrelated user changes.
3. Update behavior tests when behavior changes. Update stable docs when commands, layout, or contracts change.
4. For every non-trivial change, add or update an Agent Note according to [`.agents/notes/README.md`](.agents/notes/README.md). Mechanical and strictly local edits are exempt.
5. Run `bun run check`. Inspect `git diff --check`, `git diff`, and `git status --short` before reporting completion.
6. Report the checks actually run and any check that could not run.

## Engineering rules

- Prefer standard-library code and explicit data flow. Add a dependency only when it removes more complexity than it introduces.
- Validate untrusted input at the entry point. Keep domain logic deterministic and independently testable.
- Tests describe observable behavior, including failure behavior; they do not duplicate implementation details.
- Keep one source of truth for each fact. Link to the owner instead of copying rules into multiple files.
- Write documentation and code comments in English.
- Never commit credentials, `.env` contents, generated dependency directories, or machine-local state.
- Comments explain non-obvious constraints and reasons. Do not narrate control flow or preserve a temporary reasoning transcript.
- Files end with exactly one trailing newline.

## Agent Notes and Skills

Agent Notes preserve why a decision exists, the alternatives rejected, and its consequences. They are not task logs or summaries of a coding session.

Skills preserve repeatable procedures. A skill must have a narrow trigger, use repository rules as its source of truth, and avoid copying broad instructions from this file.

## Editing these instructions

`AGENTS.md` is the canonical project instruction file. `CLAUDE.md` is a symlink to it; edit this file, not the compatibility path. `.agents/skills` is canonical for skills, while `.claude/skills` is a compatibility symlink.
