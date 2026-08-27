# Agent Note: Device-local chat provider profiles and connection tests

Status: implemented

## Problem

The AI guide's provider form only kept one configuration in tab memory, so a learner had to re-enter the API key, Base URL, and model for each new page load or could not switch between gateways. There was also no way to distinguish invalid credentials or model names from a browser CORS failure before sending a real study question.

## Decision

The provider form now manages named profiles through a versioned, validated `localStorage` record scoped to the application's origin. A profile contains a user-facing name, API key, Base URL, and model; the active profile is restored when the reader starts and can be changed or deleted without changing PDF sessions. A dedicated same-origin `POST /api/chat/test` route sends one fixed, minimal completion request through the existing Bun proxy. Normal chat requests also default to the proxy, while direct browser transport remains an explicit library-only compatibility option.

## Alternatives considered

**Keep one tab-only configuration.** This avoids persisting secrets, but forces repetitive setup and does not meet the requirement to reuse a model across sessions.

**Store profiles on the Bun filesystem.** Server persistence would make profiles available to every browser using the process, but would expand the local server's secret-storage responsibility and make multi-user or permission boundaries ambiguous. Origin-local storage keeps the preference scoped to the device/browser that created it.

**Test with a browser-direct request.** This would reproduce provider CORS behavior rather than test the application's actual chat path. The proxy test verifies URL normalization, authorization forwarding, provider availability, and response shape on the same route used for chat.

**Probe `/models` instead of sending a completion.** Model-list endpoints are not consistently implemented by OpenAI-compatible gateways and do not prove that the selected model can complete a request. A minimal completion has broader compatibility and validates the complete contract.

## Consequences

- Saved model profiles survive page reloads and are reusable across PDF and conversation sessions in the same browser origin.
- API keys are now browser-persisted; users should only use this feature on a trusted device/profile and should delete profiles when no longer needed. Keys are not written by the Bun server.
- The connection test can incur a small provider charge and may consume quota; its prompt is intentionally short and fixed.
- Providers must expose an OpenAI-compatible non-streaming `/chat/completions` endpoint. Provider-specific request formats remain outside this iteration.
- Corrupt or unsupported local-storage entries are ignored defensively so they cannot prevent the reader from opening.
