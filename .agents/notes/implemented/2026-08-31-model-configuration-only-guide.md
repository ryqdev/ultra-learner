# Agent Note: Model-configuration-only AI Guide

Status: implemented

## Problem

The AI Guide presented an Ask-this-PDF empty state, PDF-selection context, a prompt composer, and conversation controls before the product had committed to the learning workflow that should use a configured model. Keeping that interaction implied a supported chat experience and left model setup competing with an unfinished feature.

## Decision

The AI Guide now exposes only model configuration. It keeps provider presets, API-key entry, model discovery, reasoning-level selection, connection testing, named browser-local profiles, and the resizable panel. The configuration form is visible whenever the guide opens instead of sitting behind a chat-oriented empty state.

The reader removes the prompt composer, conversation messages, PDF-context card, AI-specific selection-mode controls, and workspace New chat action. Existing model transport and selection helpers remain available as internal groundwork, but the browser does not expose a workflow that sends a question or PDF content to a model. This decision supersedes the conversation UI portions of the earlier PDF chat companion, same-origin chat proxy, reader AI entry-point, and focused reader chrome decisions.

## Alternatives considered

**Remove only the Ask-this-PDF heading.** The composer, selection card, and New chat action would still expose the same unfinished interaction without its empty-state label.

**Remove the entire AI Guide.** This would produce the smallest reader surface, but it would also discard reusable model profiles and force future model-backed features to rebuild setup and connection testing.

**Keep model setup collapsed above an empty panel.** That would preserve the previous compact summary row, but opening the guide would mostly reveal unused space and make the one remaining task less direct.

## Consequences

- Users can configure, test, save, switch, and remove model profiles without entering a conversation.
- Opening the AI Guide immediately presents the complete configuration form.
- The reader does not currently send prompts or PDF selections to a configured provider.
- The generic chat proxy and deterministic selection helpers remain tested for future use, but they are not reachable through the current interface.
