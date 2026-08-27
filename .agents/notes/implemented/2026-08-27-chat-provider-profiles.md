# Agent Note: Device-local chat provider profiles and connection tests

Status: implemented

## Problem

The AI guide's provider form only kept one configuration in tab memory, so a learner had to re-enter the API key, Base URL, and model for each new page load or could not switch between gateways. There was also no way to distinguish invalid credentials or model names from a browser CORS failure before sending a real study question.

## Decision

The provider form now manages named profiles through a versioned, validated `localStorage` record scoped to the application's origin. A profile contains a user-facing name, API key, Base URL, model, and optional reasoning intensity; the active profile is restored when the reader starts and can be changed or deleted without changing PDF sessions. The form requires manual entry only for the API key and Base URL. A Fetch models action calls a dedicated same-origin `POST /api/chat/models` route; Bun forwards a credential-bearing GET request to the provider's `/models` endpoint, and the browser normalizes standard model records plus common reasoning-capability metadata into model and intensity selectors. A dedicated same-origin `POST /api/chat/test` route sends one fixed, minimal completion request through the existing Bun proxy. Normal chat requests also default to the proxy, while direct browser transport remains an explicit library-only compatibility option. The form presents a guided setup flow with provider presets for common hosted and local OpenAI-compatible gateways, inline field help, API-key visibility control, a compact current-model summary, and explicit save/use and remove actions.

## Alternatives considered

**Keep one tab-only configuration.** This avoids persisting secrets, but forces repetitive setup and does not meet the requirement to reuse a model across sessions.

**Store profiles on the Bun filesystem.** Server persistence would make profiles available to every browser using the process, but would expand the local server's secret-storage responsibility and make multi-user or permission boundaries ambiguous. Origin-local storage keeps the preference scoped to the device/browser that created it.

**Test with a browser-direct request.** This would reproduce provider CORS behavior rather than test the application's actual chat path. The proxy test verifies URL normalization, authorization forwarding, provider availability, and response shape on the same route used for chat.

**Keep a manually typed model field and probe only with a completion.** This is compatible with gateways that omit `/models`, but it leaves transcription errors and unknown model availability to the learner. The shipped flow uses `/models` for discovery and keeps the completion test as a separate validation step; a gateway without a compatible model-list endpoint can still be used through a saved profile created elsewhere.

## Consequences

- Saved model profiles survive page reloads and are reusable across PDF and conversation sessions in the same browser origin.
- API keys are now browser-persisted; users should only use this feature on a trusted device/profile and should delete profiles when no longer needed. Keys are not written by the Bun server.
- The connection test can incur a small provider charge and may consume quota; its prompt is intentionally short and fixed.
- Providers must expose an OpenAI-compatible `/models` endpoint for automatic discovery and a non-streaming `/chat/completions` endpoint for chat; provider-specific request formats remain outside this iteration.
- Corrupt or unsupported local-storage entries are ignored defensively so they cannot prevent the reader from opening.
- Common provider presets reduce endpoint and model transcription errors; custom OpenAI-compatible URLs remain supported.
- Model discovery is deliberately defensive: standard `{ data: [{ id }] }` catalogs work directly, provider capability fields are recognized when present, and a reasoning-capable record without explicit levels receives conservative low/medium/high choices. Providers that do not expose a catalog or reasoning metadata cannot provide automatic choices and need a compatible saved setup or a future provider adapter.
- Changing the API key or Base URL invalidates the in-memory catalog, so a model cannot accidentally be saved or tested against credentials different from those used to discover it.
- The setup form is intentionally scroll-constrained so its guidance and controls remain usable inside the resizable study panel and on compact screens.
