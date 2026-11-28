import { resolve } from "node:path";

export type CliOptions =
  | { mode: "help" }
  | { mode: "version" }
  | {
    mode: "serve";
    port: number;
    /** Present only when chosen; the server otherwise binds to loopback. */
    hostname?: string;
    allowedHosts: string[];
    /** An absolute path, present only when chosen; the session store otherwise uses its default. */
    dataDirectory?: string;
  };

/** The process environment; only the named variables are read. */
export interface CliEnvironment {
  PORT?: string;
  ULTRA_LEARNER_HOME?: string;
  [name: string]: string | undefined;
}

const USAGE = "Expected --port <port>, --host <address>, --allow-host <host>, --data-dir <path>, --help, or --version.";

const HOST_NAME_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/;
const BRACKETED_IPV6_PATTERN = /^\[[0-9a-fA-F:.]+\]$/;
const BARE_IPV6_PATTERN = /^[0-9a-fA-F.]*:[0-9a-fA-F:.]*$/;

/** Read a bind address, removing IPv6 brackets because Bun expects the bare address. */
function bindAddress(value: string): string {
  const address = BRACKETED_IPV6_PATTERN.test(value) ? value.slice(1, -1) : value;
  if (!HOST_NAME_PATTERN.test(address) && !BARE_IPV6_PATTERN.test(address)) {
    throw new TypeError("Host must be a host name or IP address without a port.");
  }
  return address;
}

export function parseCliArguments(args: string[], environment: CliEnvironment = {}): CliOptions {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) return { mode: "help" };
  if (args.length === 1 && (args[0] === "--version" || args[0] === "-v")) return { mode: "version" };

  let port = environment.PORT ?? "8881";
  let hostname: string | undefined;
  const allowedHosts: string[] = [];
  let dataDirectory = environment.ULTRA_LEARNER_HOME === undefined
    ? undefined
    : { path: environment.ULTRA_LEARNER_HOME, source: "ULTRA_LEARNER_HOME" };
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (value === undefined) throw new TypeError(USAGE);
    if (flag === "--port") {
      port = value;
    } else if (flag === "--host") {
      hostname = bindAddress(value);
    } else if (flag === "--allow-host") {
      if (!HOST_NAME_PATTERN.test(value) && !BRACKETED_IPV6_PATTERN.test(value)) {
        throw new TypeError("Allowed host must be a host name or IP address without a port.");
      }
      allowedHosts.push(value);
    } else if (flag === "--data-dir") {
      dataDirectory = { path: value, source: "--data-dir" };
    } else {
      throw new TypeError(USAGE);
    }
  }
  if (!/^\d+$/.test(port) || Number(port) > 65535) {
    throw new TypeError("Port must be an integer from 0 to 65535.");
  }
  // An empty value is a configuration mistake, and resolving it would quietly store PDFs in the working directory.
  if (dataDirectory && !dataDirectory.path.trim()) {
    throw new TypeError(`${dataDirectory.source} must name a directory.`);
  }
  return {
    mode: "serve",
    port: Number(port),
    ...(hostname === undefined ? {} : { hostname }),
    allowedHosts,
    ...(dataDirectory ? { dataDirectory: resolve(dataDirectory.path) } : {}),
  };
}

/** The canonical URL host name of a bind address, or `null` when it cannot be one. */
function canonicalHostname(address: string): string | null {
  try {
    return new URL(`http://${address.includes(":") ? `[${address}]` : address}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Whether only this machine can connect to a bind address. Any address that is
 * not plainly loopback counts as reachable, so an unusual spelling warns rather
 * than passes silently.
 */
export function isLoopbackAddress(address: string): boolean {
  const hostname = canonicalHostname(address);
  return hostname === "localhost" || hostname === "[::1]" || /^127\.\d+\.\d+\.\d+$/.test(hostname ?? "");
}

/**
 * The address to open in a browser on this machine. A wildcard bind address
 * accepts connections but is not a name the server answers to, so its loopback
 * counterpart is printed instead.
 */
export function localBrowserUrl(serverUrl: URL): URL {
  const url = new URL(serverUrl);
  if (url.hostname === "0.0.0.0") url.hostname = "127.0.0.1";
  else if (url.hostname === "[::]") url.hostname = "[::1]";
  return url;
}
