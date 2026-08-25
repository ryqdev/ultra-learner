# Architecture

This repository separates product code from AI development infrastructure in two small layers.

```text
User request
   ↓
AGENTS.md ──→ Agent Notes ──→ Skill
   ↓              ↓             ↓
Code and tests ←── Stable decisions ←── Repeatable workflows
   ↓
bun run check
```

## Product Layer

`src/` contains executable code, while `test/` verifies only observable behavior. The example has no third-party dependencies or model calls. A real project can replace this layer without changing how agents understand and verify the repository.

## Agent Layer

`AGENTS.md` contains concise, current operating rules. It covers project structure, common commands, engineering constraints, and completion criteria without carrying design history.

`.agents/notes/` is durable decision memory. It contains only rationale, genuine alternatives, and consequences that code and current-state documentation cannot express. Directory lifecycles distinguish proposals, implemented reality, and explicitly rejected directions.

`.agents/skills/` contains progressively disclosed workflows. Agents discover a Skill by its name and description, then load its full instructions only when the task matches.

`bun run check` closes the feedback loop. A rule becomes repeatable evidence only when the top-level check enforces it. The current check covers product tests, Agent Note format, and compatibility symlinks. Add new invariants only when a real risk appears.

## Information Ownership

- Current project rules belong in `AGENTS.md`.
- Current architecture belongs in `docs/` or API documentation near the code.
- Decision rationale and trade-offs belong in Agent Notes.
- Repeatable procedures belong in Skills or `scripts/`.
- Machine-verifiable constraints belong in tests or the top-level check.

Each fact has one owner; other locations link to it. This constraint matters more than adding more documentation types.

## Extension Principle

Add a new layer, Skill, check, dependency, or agent role only when a requirement appears. Every non-trivial extension should identify the problem it solves, the simpler alternatives rejected, and the verification that proves it works.
