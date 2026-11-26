# Agent Note: Host validation on the local server

Status: implemented

## Problem

The Bun server binds to loopback and serves saved PDFs, deletion, and a credential-forwarding model proxy without authentication. Binding to loopback does not stop a web page from reaching it: a page on another domain can re-point its own DNS name at `127.0.0.1` after loading, at which point the browser treats the reader's API as that page's own origin. CORS preflight does not apply to a same-origin request, so the page could list, download, and delete every saved PDF and drive the proxy.

## Decision

Every request must name a host this server is known by. The server accepts `127.0.0.1`, `localhost`, and `[::1]`, the specific address it was asked to bind to, and any names passed through the `allowedHosts` server option or the repeatable `--allow-host <host>` CLI flag. Wildcard bind addresses add nothing to the set. The comparison uses the host name only, ignoring port and letter case. Anything else, including a missing `Host` header, receives `403` before routing, so the check covers static files and the health endpoint as well as the API.

## Alternatives considered

**Rely on loopback binding and CORS.** This is the previous behavior. It blocks ordinary cross-site requests that need a preflight, but a rebound name is same-origin and bypasses it.

**Require a per-process secret token on API requests.** A token also stops other local processes, but it has to reach the page somehow, complicates every client request, and still leaves static assets addressable by a rebound name. Host validation closes the browser-borne path with no client change.

**Check `Origin` instead of `Host`.** Browsers omit `Origin` on same-origin `GET` requests, so reads of the session list and saved documents would stay exposed.

## Consequences

- A page served from any other host name cannot read or change local sessions, even after DNS rebinding.
- Opening the reader through a forwarding proxy or tunnel that presents its own host name now fails with `403` until that name is passed with `--allow-host`.
- Other processes on the same machine can still call the API directly; the check defends the browser boundary, not the local account.
- Saved model profiles remain isolated separately by the browser's origin rules and were not reachable through a rebound name.
