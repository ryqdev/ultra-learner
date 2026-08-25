---
name: project-check
description: Use before handing off a code or documentation change in this repository to run the required gates and inspect the final diff.
---

# Project Check

Use this workflow after implementation and before reporting completion. Repository rules remain authoritative in [`AGENTS.md`](../../../AGENTS.md); this skill only packages the repeatable verification sequence.

## Workflow

1. Run `bun run check` from the repository root.
2. If it fails, fix the reported cause and rerun the narrow failing command before rerunning `bun run check` once.
3. Run `git diff --check` to catch whitespace errors.
4. Read `git diff` and confirm every changed line belongs to the requested outcome.
5. Run `git status --short` to identify untracked files and preserve unrelated user work.
6. Report the exact commands that passed. Report any command that could not run and the reason.

Do not claim success from partial output, replace a failing check with manual inspection, or create a commit unless the user asks for one.
