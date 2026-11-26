export type CliOptions =
  | { mode: "help" }
  | { mode: "version" }
  | { mode: "serve"; port: number; allowedHosts: string[] };

const USAGE = "Expected --port <port>, --allow-host <host>, --help, or --version.";

export function parseCliArguments(args: string[], environmentPort?: string): CliOptions {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) return { mode: "help" };
  if (args.length === 1 && (args[0] === "--version" || args[0] === "-v")) return { mode: "version" };

  let port = environmentPort ?? "8881";
  const allowedHosts: string[] = [];
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (value === undefined) throw new TypeError(USAGE);
    if (flag === "--port") {
      port = value;
    } else if (flag === "--allow-host") {
      if (!/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?|\[[0-9a-fA-F:.]+\])$/.test(value)) {
        throw new TypeError("Allowed host must be a host name or IP address without a port.");
      }
      allowedHosts.push(value);
    } else {
      throw new TypeError(USAGE);
    }
  }
  if (!/^\d+$/.test(port) || Number(port) > 65535) {
    throw new TypeError("Port must be an integer from 0 to 65535.");
  }
  return { mode: "serve", port: Number(port), allowedHosts };
}
