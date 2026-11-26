#!/usr/bin/env bun
import { version } from "../package.json";
import { parseCliArguments } from "./cli.ts";
import { createAppServer } from "./server.ts";

if (import.meta.main) {
  try {
    const options = parseCliArguments(Bun.argv.slice(2), Bun.env.PORT);
    if (options.mode === "help") {
      console.log(`Usage: ultra-learner [--port <port>] [--allow-host <host>]

Start the local PDF reader, then open the printed URL in your browser.
Requires Bun 1.3 or newer.

  --port <port>        Listen on this port (overrides PORT; default: 8881).
  --allow-host <host>  Also answer requests addressed to this host name, such
                       as a forwarding proxy's. Repeat for several names.
  -h, --help           Show this help.
  -v, --version        Show the installed version.

PDF sessions are saved in ~/.ultra-learner. Press Ctrl+C to stop.`);
    } else if (options.mode === "version") {
      console.log(version);
    } else {
      const server = createAppServer({ port: options.port, allowedHosts: options.allowedHosts });
      console.log(`Ultra Learner is ready at ${server.url}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Unable to start Ultra Learner.");
    process.exitCode = 1;
  }
}

export { createAppServer } from "./server.ts";
