# Agent Note: Minimal AI-native repository foundation

Status: implemented

## Problem

An empty repository gives a coding agent no reliable project context, no durable record of design rationale, no reusable local workflow, and no repository-defined proof that a change is complete. Copying a mature agent harness wholesale would solve those problems by introducing far more structure than a new project can justify.

## Decision

The repository uses four agent-facing primitives:

1. Root `AGENTS.md` is the canonical operating contract. `CLAUDE.md` points to it so compatible clients share one source of truth.
2. `.agents/notes/` stores lifecycle-based decisions. Non-trivial changes add or update a note, while mechanical local edits remain lightweight.
3. `.agents/skills/` stores narrow reusable workflows. `.claude/skills` points to the same directory for client compatibility and progressive disclosure.
4. `bun run check` is the single local completion gate. It runs behavior tests and validates the agent-facing repository structure.

The repository uses TypeScript for executable product code, tests, and validation scripts. Bun is the sole dependency manager, script runner, test runner, application runtime, and lockfile owner; commands and lockfiles from other package managers are outside the project contract. A lockfile is retained when product dependencies exist and is omitted when there are none. The repository owns this structure and its decisions independently; no external project's names, history, or conventions are part of its public identity. Product-specific architecture is allowed to evolve independently while preserving this agent-facing foundation.

Repository documentation and code comments use English so every supported agent entry point reads one consistent language without requiring parallel translations.

## Alternatives considered

**Adopt a mature agent platform structure wholesale.** A monorepo layout, plugin architecture, generated catalogs, bilingual documentation gates, and many specialized skills solve scale-specific problems that this repository does not yet have.

**Keep only `AGENTS.md`.** Instructions provide present-tense rules but do not preserve decision trade-offs, package repeatable procedures for on-demand use, or prove that repository invariants hold.

**Maintain separate instructions for each agent client.** Independent `AGENTS.md` and `CLAUDE.md` files would allow client-specific wording, but shared rules would drift. Symlinks keep one canonical contract while leaving room for future truly client-specific files if a concrete need appears.

**Start with an LLM SDK and agent runtime.** That would make the example an AI-powered application, but it would couple the development template to credentials, network access, one provider, and fast-changing APIs. AI-native development infrastructure is useful independently of product AI features.

**Use separate dependency-management and runtime tools.** That toolchain is widely available, but Bun supplies installation, script execution, testing, and one lockfile format through a single project tool.

## Consequences

- A new agent can discover project purpose, commands, constraints, and completion criteria from one short file.
- Durable rationale and repeatable procedures remain versioned beside the code without occupying every prompt.
- One command provides deterministic local evidence and is also suitable for CI.
- Local development and CI use the same Bun-owned install, execution, type-check, test, and lockfile path.
- Documentation stays concise and consistent without a localization synchronization process.
- The foundation deliberately leaves model providers, deployment, multi-agent orchestration, and additional skills undecided until requirements justify them; product architecture is recorded in its own Agent Notes.
