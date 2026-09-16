export type CliOptions = { mode: "help" } | { mode: "version" } | { mode: "serve"; port: number };

export function parseCliArguments(args: string[], environmentPort?: string): CliOptions {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) return { mode: "help" };
  if (args.length === 1 && (args[0] === "--version" || args[0] === "-v")) return { mode: "version" };

  let port = environmentPort ?? "8881";
  if (args.length > 0) {
    if (args[0] !== "--port" || args.length !== 2) {
      throw new TypeError("Expected --port <port>, --help, or --version.");
    }
    port = args[1]!;
  }
  if (!/^\d+$/.test(port) || Number(port) > 65535) {
    throw new TypeError("Port must be an integer from 0 to 65535.");
  }
  return { mode: "serve", port: Number(port) };
}
