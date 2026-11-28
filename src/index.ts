#!/usr/bin/env bun
import { version } from "../package.json";
import { isLoopbackAddress, localBrowserUrl, parseCliArguments } from "./cli.ts";
import { createAppServer } from "./server.ts";

const DEPLOYMENT_GUIDE = "https://github.com/ryqdev/ultra-learner/blob/main/docs/deployment.md";

if (import.meta.main) {
  try {
    const options = parseCliArguments(Bun.argv.slice(2), Bun.env);
    if (options.mode === "help") {
      console.log(`Usage: ultra-learner [--port <port>] [--host <address>] [--allow-host <host>]
                     [--data-dir <path>]

Start the local PDF reader, then open the printed URL in your browser.
Requires Bun 1.3 or newer.

  --port <port>        Listen on this port (overrides PORT; default: 8881).
  --host <address>     Listen on this address (default: 127.0.0.1). The reader
                       has no accounts: anything other than loopback must sit
                       behind a gateway that authenticates visitors over HTTPS.
  --allow-host <host>  Also answer requests addressed to this host name, such
                       as a forwarding proxy's. Repeat for several names.
  --data-dir <path>    Save PDF sessions in this directory (overrides
                       ULTRA_LEARNER_HOME; default: ~/.ultra-learner).
  -h, --help           Show this help.
  -v, --version        Show the installed version.

Self-hosting guide: ${DEPLOYMENT_GUIDE}
Press Ctrl+C to stop.`);
    } else if (options.mode === "version") {
      console.log(version);
    } else {
      const server = createAppServer({
        port: options.port,
        hostname: options.hostname,
        allowedHosts: options.allowedHosts,
        sessionRoot: options.dataDirectory,
      });
      console.log(`Ultra Learner is ready at ${localBrowserUrl(server.url)}`);
      if (options.hostname !== undefined && !isLoopbackAddress(options.hostname)) {
        console.warn(`Warning: Ultra Learner is listening on ${options.hostname} and has no authentication.
Anyone who can connect can read, upload, and delete every saved PDF, and can make
this server send requests to any address it can reach. Expose it only through a
gateway that authenticates visitors over HTTPS: ${DEPLOYMENT_GUIDE}`);
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Unable to start Ultra Learner.");
    process.exitCode = 1;
  }
}

export { createAppServer } from "./server.ts";
