# Agent Note: Single-user self-hosting behind an authenticating gateway

Status: implemented

## Problem

The reader is built for one person on one machine: it binds to `127.0.0.1` and keeps sessions in `~/.ultra-learner`. Some people want to run the same process on a server so one library opens from several of their devices. A reverse proxy on the same host could already reach it. A container could not publish its port, though, and the data directory could move only by changing `HOME` or by calling the programmatic `sessionRoot` option. Nothing said what had to sit in front of the process.

The reader has no accounts. On a reachable host, anyone could list, download, and delete every saved PDF, and could use the model routes to send requests from the server into its private network. The browser also sends model API keys to the server in the `Authorization` header, so a remote deployment needs HTTPS.

## Decision

Self-hosting is supported for a single user, and the reader's security model does not change. Authentication and HTTPS belong to a gateway in front of it, and [`docs/deployment.md`](../../../docs/deployment.md) is the operator-facing owner of those requirements and the supported setups.

- `--host <address>` chooses the bind address. The default stays `127.0.0.1`. Brackets around an IPv6 address are removed because Bun binds the bare form. When the chosen address is anything other than `localhost`, `127.0.0.0/8`, or `::1`, the CLI prints a warning to standard error that links to the deployment guide. A wildcard bind prints its loopback counterpart as the ready URL, because [host validation](2026-11-26-local-server-host-validation.md) does not accept wildcard names and the URL Bun reports would answer `403`.
- `--data-dir <path>` chooses the session directory, with `ULTRA_LEARNER_HOME` as the fallback. The path is resolved against the starting directory. An empty or blank value from either source stops startup with a message naming that source. Without either one, the session store keeps owning the default.
- Host validation is unchanged. A gateway that forwards its public name needs that name passed with `--allow-host`.
- The bundle built once per process already shipped with the [serving contract](2026-11-26-server-request-and-serving-contract.md), so self-hosting only documents it. The systemd example still sets `NODE_ENV=production` to state the intent.
- The guide excludes gateways that use HTTP Basic authentication. The reader sends model API keys as `Authorization: Bearer …`, and on those requests that header replaces the browser's Basic credentials, so such a gateway refuses model discovery and the connection test.

## Alternatives considered

**Authentication inside the reader.** A password or token would need a login screen, credential storage, session cookies, and CSRF handling, which starts an account system. Gateways already offer single sign-on, multi-factor authentication, and device identity, and the local default would have to carry code it never uses.

**A Base URL allowlist or private-network blocking in the model proxy.** Local providers such as Ollama and LM Studio need loopback access. Behind an authenticating gateway, only the owner can drive the proxy. Blocking matters only for a multi-user or unauthenticated public service, which is not supported.

**Refusing a non-loopback bind without an extra confirmation flag.** The reader cannot detect a gateway, so a confirmation flag would only be a ritual, and it would make every container start longer. A warning reminds without blocking a deliberate setup.

**Treating an empty `ULTRA_LEARNER_HOME` as unset.** That convention is common, but an empty value in a unit file or container definition is almost always a mistake. Treating it as unset would quietly put the library in the service user's home directory, away from the volume or backup that was meant to hold it.

**An official container image.** It can follow now that `--host` exists. Until then the guide shows the flags a container needs.

## Consequences

- Starting without flags behaves as before: it binds to loopback on port 8881, stores sessions in `~/.ultra-learner`, and prints no warning.
- A container can publish its port with `--host 0.0.0.0` but still needs `--allow-host` for the gateway's name.
- Self-hosting is single-user. Everyone who passes the gateway shares one library and its reading positions. Model profiles stay in each browser's storage for the site address, and local provider presets reach programs on the server, not on the reader's device.
- The warning and the guide are the only guards, because the reader cannot see whether a gateway exists. A same-host proxy in front of a loopback bind gets no warning.
- Behind a gateway that signs visitors in with a cookie, other sites can make the browser send requests that carry that cookie. Every state-changing route currently needs a CORS preflight, which the server never approves: deletes and position updates use `DELETE` and `PUT`, uploads need a filename header, and model routes need `Authorization`. An upload sent without the filename header is refused. A new route that changes state through a request the browser sends without a preflight would be exposed to such cross-site requests.
