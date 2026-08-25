# AI Native Development Starter

An independent, minimal, and complete AI-native project starter. Here, “AI native” means the repository helps coding agents quickly acquire context, understand past decisions, invoke reusable workflows, and prove changes with deterministic checks. The product itself does not need to call a language model.

## Four Core Elements

| Element | Location | Purpose |
| --- | --- | --- |
| Project context | [`AGENTS.md`](AGENTS.md) | Explains what the project is, how to change it, and what completion means. |
| Decision memory | [`.agents/notes/`](.agents/notes/README.md) | Preserves rationale, trade-offs, and consequences that code cannot express. |
| Reusable capabilities | [`.agents/skills/`](.agents/skills/) | Packages recurring workflows as Skills loaded on demand. |
| Feedback loop | `bun run check` | Provides machine-verifiable evidence through tests and repository checks. |

`CLAUDE.md` points to `AGENTS.md`, and `.claude/skills` points to `.agents/skills`. Different agent entry points therefore read the same sources of truth instead of maintaining rules that can drift apart.

## Quick Start

Requires Bun 1.3 or newer and has no third-party runtime dependencies.

```sh
bun install
bun run start -- Alice
bun run check
```

The TypeScript example prints a single greeting and uses minimal code to demonstrate the edit, test, and check loop. Replace `src/` and `test/` when starting a real project while keeping the AI-native layer.

## Layout

```text
.
├── AGENTS.md                 # Canonical project instructions
├── CLAUDE.md -> AGENTS.md    # Claude-compatible entry point
├── .agents/
│   ├── notes/                # Lifecycle-based decision records
│   └── skills/project-check/ # Minimal verification workflow
├── .claude/skills -> ../.agents/skills
├── docs/architecture.md      # Stable current architecture
├── scripts/check-agent-notes.ts
├── src/index.ts
└── test/index.test.ts
```

## Daily Workflow

1. Read stable rules from `AGENTS.md` and current facts from the relevant code and documentation.
2. Before a non-trivial change, find the owning Agent Note; update it or add a new decision record.
3. Add a Skill only for a recurring workflow, not to preserve a one-off prompt.
4. Update the code, tests, and affected documentation.
5. Run `bun run check`, then inspect `git diff` and `git status`.

See [`docs/architecture.md`](docs/architecture.md) for further boundaries.

## Intentionally Omitted Complexity

This starter does not include multi-agent orchestration, an LLM SDK, a plugin framework, a monorepo, generated documentation, localization synchronization, or many role-specific Skills. Introduce them only when a real requirement exists, with the rationale captured in an Agent Note.
