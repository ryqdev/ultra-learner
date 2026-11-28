# Self-hosting

Ultra Learner is built for one person. Started without flags it listens on `127.0.0.1:8881` and keeps PDFs in `~/.ultra-learner`, and that is the right setup for reading on a single machine. This guide runs the same process on a server so one library can be opened from several of your devices.

Self-hosting is single-user by design. Everyone who gets through the gateway shares one library, with no accounts, per-user storage, or quotas.

## A gateway that authenticates visitors is required

The reader has no accounts. Anyone who can reach it can:

- list, download, upload, and delete every saved PDF through `/api/sessions`;
- make the server send requests to any HTTP(S) Base URL through the model routes (`/api/chat/models` and `/api/chat/test`) and read the answers, including addresses on the server's private network.

The browser also sends model API keys to the server in the `Authorization` header, so the connection between the browser and the server must use HTTPS.

Always put the reader behind a gateway that authenticates every visitor and terminates HTTPS, such as Tailscale Serve, Cloudflare Access, oauth2-proxy, or Caddy or nginx with an authentication service. The reader cannot detect whether one is in front of it. Starting it with a `--host` address other than loopback prints a warning as a reminder.

The gateway must:

- **Authenticate every request** before it reaches the reader, including `/assets/` and `/api/` paths.
- **Not use HTTP Basic authentication.** The reader sends model API keys as `Authorization: Bearer …` when it fetches models or tests a connection. That header replaces the browser's Basic credentials on those requests, so a Basic-auth gateway refuses them. A gateway that keeps its sign-in in a cookie or relies on network identity works.
- **Accept request bodies slightly larger than 100 MiB** (104,857,600 bytes), the reader's PDF upload limit. Then the reader, not the gateway, explains why a file is too large.
- **Wait more than 60 seconds for a response.** The reader gives a model provider up to 60 seconds before answering with `504`.
- **Forward a host name the reader accepts.** See [Host names](#host-names).

After setup, open the AI Guide and fetch models with a working profile. If the gateway itself answers `401` or redirects to its sign-in page, it is treating the reader's API key as its own credentials and needs to authenticate by its cookie instead.

## Options

| Flag | Environment variable | Default | Purpose |
| --- | --- | --- | --- |
| `--host <address>` | | `127.0.0.1` | Address to listen on. Use `0.0.0.0` or `::` only when the gateway connects from another machine or container. |
| `--port <port>` | `PORT` | `8881` | Port to listen on. |
| `--allow-host <host>` | | none | Another host name the reader answers to. Repeat for several names. |
| `--data-dir <path>` | `ULTRA_LEARNER_HOME` | `~/.ultra-learner` | Directory for saved PDF sessions. A relative path is resolved against the starting directory. An empty value stops the reader at startup. |
| | `NODE_ENV` | | `development` rebuilds the browser bundle on every request. Any other value, or none, builds it once per process. |

A flag takes precedence over its environment variable.

### Host names

To block DNS rebinding, the reader answers only requests whose `Host` header names `127.0.0.1`, `localhost`, `[::1]`, its `--host` address, or a name passed with `--allow-host`. Port and letter case are ignored. A wildcard address such as `0.0.0.0` adds no names.

Many gateways forward the visitor's host name (for example, `reader.example.com`) unchanged, so pass that name:

```sh
bunx @ryqdev/ultra-learner --allow-host reader.example.com
```

A `403` reply reading "This server only answers requests addressed to its local address." means the name the gateway forwards is missing.

## Private use: Tailscale Serve

Tailscale Serve publishes a local service over HTTPS to the devices in your tailnet. Tailnet membership is the authentication. The reader stays on loopback:

```sh
bunx @ryqdev/ultra-learner --allow-host reader.your-tailnet.ts.net
```

```sh
tailscale serve --bg http://127.0.0.1:8881
```

Replace `reader.your-tailnet.ts.net` with the machine's MagicDNS name, which `tailscale serve status` shows. Name the target `127.0.0.1` rather than `localhost`, which can resolve to `::1`, where the reader does not listen. If your Tailscale version takes different arguments, see `tailscale serve --help`.

Everyone who can reach the machine on the tailnet shares the library, so restrict access with your tailnet's access controls when you share the machine. Do not use Tailscale Funnel, which publishes the service to the whole internet without a sign-in.

## Public domain: Caddy with authentication

Caddy obtains a certificate for the domain and terminates HTTPS. An authentication service checks each request, and the reader stays on loopback:

```caddyfile
reader.example.com {
	# Add your authentication provider's Caddy configuration here, for example
	# a forward_auth block for Authelia, authentik, or oauth2-proxy.

	request_body {
		max_size 110MB
	}

	reverse_proxy 127.0.0.1:8881
}
```

```sh
bunx @ryqdev/ultra-learner --allow-host reader.example.com
```

Caddy passes the visitor's `Host` header to the reader, so the domain must be allowed. The `max_size` value sits above the reader's 100 MiB limit whether `MB` is read as decimal or binary.

### Limits on other gateways

nginx refuses bodies over 1 MB and gives up on an upstream after 60 seconds by default, so both settings need raising:

```nginx
client_max_body_size 101m;

location / {
    proxy_pass http://127.0.0.1:8881;
    proxy_set_header Host $host;
    proxy_read_timeout 90s;
}
```

Cloudflare caps proxied request bodies by plan. On a plan whose cap is 100 MB, below the reader's 100 MiB, the largest PDFs fail at Cloudflare with `413`.

## Running as a service

This systemd unit runs a pinned release as a dedicated user and keeps the library in that user's home directory:

```sh
sudo useradd --system --create-home --home-dir /var/lib/ultra-learner --shell /usr/sbin/nologin ultra-learner
```

```ini
# /etc/systemd/system/ultra-learner.service
[Unit]
Description=Ultra Learner PDF reader
After=network-online.target
Wants=network-online.target

[Service]
User=ultra-learner
Environment=NODE_ENV=production
Environment=ULTRA_LEARNER_HOME=/var/lib/ultra-learner/library
# Pin the release you have tested; change the version deliberately to upgrade.
ExecStart=/usr/local/bin/bunx @ryqdev/ultra-learner@0.2.0 --allow-host reader.example.com
Restart=on-failure
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload
```

```sh
sudo systemctl enable --now ultra-learner
```

The package's command starts through `#!/usr/bin/env bun`, so Bun must be on the service's `PATH`. The unit assumes `bun` and `bunx` are in `/usr/local/bin`. Bun's installer puts them in `~/.bun/bin`, so either copy them or add an `Environment=PATH=…` line. `NODE_ENV=production` declares the intent explicitly; any value other than `development` already serves a bundle that is built once.

### Containers

There is no official image. In a container, listen on every interface so the published port reaches the process, keep the data directory on a volume, and publish the port only where the gateway can reach it, for example `-p 127.0.0.1:8881:8881`:

```sh
bunx @ryqdev/ultra-learner@0.2.0 --host 0.0.0.0 --data-dir /data --allow-host reader.example.com
```

## Data and backups

Everything the server keeps is in the data directory:

```text
<data directory>/
└── sessions/
    └── <session id>/
        ├── metadata.json   Original filename, size, and upload time.
        ├── document.pdf    The uploaded file.
        └── progress.json   The last page shown, once a page has been reported.
```

Back up the whole data directory. Copying it while the reader runs is safe. A session directory appears only after its upload is complete, and position updates replace `progress.json` by renaming. Entries named `.incoming-*` and `progress.json.*.tmp` are unfinished writes that the reader removes on a later start; skip them. To restore, stop the reader, put the directory back, and start it again.

Saved model profiles, including their API keys, and the theme choice are not on the server. They stay in each browser's storage for the site address.

## What changes when the reader is self-hosted

- **Model profiles do not follow you.** `localStorage` is scoped to the site address, so profiles saved at `http://127.0.0.1:8881` do not appear at `https://reader.example.com`. Each browser and device keeps its own.
- **Local provider presets point at the server.** The Ollama (`http://127.0.0.1:11434/v1`) and LM Studio (`http://127.0.0.1:1234/v1`) presets reach those programs on the server, not on the device you read from. Use an address the server can reach.
- **One shared library.** Every visitor who passes the gateway sees, opens, and can delete the same sessions, and reading positions are shared with them.
