import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { isLoopbackAddress, localBrowserUrl, parseCliArguments } from "../src/cli.ts";

describe("CLI options", () => {
  test("uses the default port, environment, and explicit override", () => {
    expect(parseCliArguments([])).toEqual({ mode: "serve", port: 8881, allowedHosts: [] });
    expect(parseCliArguments([], { PORT: "4100" })).toEqual({ mode: "serve", port: 4100, allowedHosts: [] });
    expect(parseCliArguments(["--port", "4200"], { PORT: "4100" }))
      .toEqual({ mode: "serve", port: 4200, allowedHosts: [] });
    expect(parseCliArguments(["--port", "0"])).toEqual({ mode: "serve", port: 0, allowedHosts: [] });
  });

  test("collects extra host names the server may be addressed by", () => {
    expect(parseCliArguments(["--allow-host", "reader.internal", "--port", "4200", "--allow-host", "[::1]"]))
      .toEqual({ mode: "serve", port: 4200, allowedHosts: ["reader.internal", "[::1]"] });
    for (const host of ["", "reader.internal:8881", "http://reader.internal", "two words", "-leading"]) {
      expect(() => parseCliArguments(["--allow-host", host])).toThrow("Allowed host must");
    }
    expect(() => parseCliArguments(["--allow-host"])).toThrow("Expected");
  });

  test("binds to a chosen address, given as a name or an IPv4 or IPv6 address", () => {
    expect(parseCliArguments(["--host", "0.0.0.0"])).toEqual({
      mode: "serve",
      port: 8881,
      hostname: "0.0.0.0",
      allowedHosts: [],
    });
    expect(parseCliArguments(["--host", "reader.lan", "--host", "192.168.1.20"])).toMatchObject({ hostname: "192.168.1.20" });
    // Bun binds a bare IPv6 address, so brackets are accepted and removed.
    expect(parseCliArguments(["--host", "::"])).toMatchObject({ hostname: "::" });
    expect(parseCliArguments(["--host", "[::1]"])).toMatchObject({ hostname: "::1" });
    for (const host of ["", "reader.lan:8881", "http://reader.lan", "two words", "-leading", "[reader.lan]"]) {
      expect(() => parseCliArguments(["--host", host])).toThrow("Host must");
    }
    expect(() => parseCliArguments(["--host"])).toThrow("Expected");
  });

  test("stores sessions in a chosen directory, preferring the flag to the environment", () => {
    expect(parseCliArguments([], { ULTRA_LEARNER_HOME: "/srv/library" }))
      .toEqual({ mode: "serve", port: 8881, allowedHosts: [], dataDirectory: "/srv/library" });
    expect(parseCliArguments(["--data-dir", "/var/lib/reader"], { ULTRA_LEARNER_HOME: "/srv/library" }))
      .toMatchObject({ dataDirectory: "/var/lib/reader" });
    // A relative path is fixed against the starting directory, so it cannot move while the server runs.
    expect(parseCliArguments(["--data-dir", "library"])).toMatchObject({ dataDirectory: resolve("library") });
    // The flag replaces the environment value entirely, even an unusable one.
    expect(parseCliArguments(["--data-dir", "/var/lib/reader"], { ULTRA_LEARNER_HOME: "" }))
      .toMatchObject({ dataDirectory: "/var/lib/reader" });
  });

  test("refuses an empty data directory instead of saving into the working directory", () => {
    for (const path of ["", "  "]) {
      expect(() => parseCliArguments(["--data-dir", path])).toThrow("--data-dir must name a directory.");
      expect(() => parseCliArguments([], { ULTRA_LEARNER_HOME: path })).toThrow("ULTRA_LEARNER_HOME must name a directory.");
    }
    expect(() => parseCliArguments(["--data-dir"])).toThrow("Expected");
  });

  test("help and version do not depend on the server configuration", () => {
    const environment = { PORT: "bad", ULTRA_LEARNER_HOME: "" };
    for (const flag of ["--help", "-h"]) expect(parseCliArguments([flag], environment)).toEqual({ mode: "help" });
    for (const flag of ["--version", "-v"]) expect(parseCliArguments([flag], environment)).toEqual({ mode: "version" });
  });

  test("rejects unsupported arguments and invalid ports before starting a server", () => {
    for (const args of [["--unknown"], ["--port"], ["--port", "80", "extra"], ["--help", "extra"]]) {
      expect(() => parseCliArguments(args)).toThrow("Expected");
    }
    for (const port of ["", "abc", "-1", "1.5", "65536", "Infinity", "1e3", " 80"]) {
      expect(() => parseCliArguments(["--port", port])).toThrow("Port must");
      expect(() => parseCliArguments([], { PORT: port })).toThrow("Port must");
    }
  });
});

describe("bind address exposure", () => {
  test("treats only loopback addresses as private to this machine", () => {
    for (const address of ["127.0.0.1", "127.8.9.10", "localhost", "LOCALHOST", "::1", "0:0:0:0:0:0:0:1"]) {
      expect(isLoopbackAddress(address)).toBe(true);
    }
    for (const address of ["0.0.0.0", "::", "192.168.1.20", "10.0.0.5", "fe80::1", "reader.lan", "localhost.example"]) {
      expect(isLoopbackAddress(address)).toBe(false);
    }
  });

  test("prints a loopback address a browser can open for a wildcard bind", () => {
    expect(localBrowserUrl(new URL("http://0.0.0.0:8881/")).href).toBe("http://127.0.0.1:8881/");
    expect(localBrowserUrl(new URL("http://[::]:8881/")).href).toBe("http://[::1]:8881/");
    expect(localBrowserUrl(new URL("http://192.168.1.20:8881/")).href).toBe("http://192.168.1.20:8881/");
    expect(localBrowserUrl(new URL("http://localhost:8881/")).href).toBe("http://localhost:8881/");
  });
});

const entryPoint = join(import.meta.dir, "..", "src", "index.ts");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "ultra-learner-cli-"));
  temporaryDirectories.push(path);
  return path;
}

interface RunningCommand {
  url: URL;
  /** Stop the command and return everything it wrote to standard error. */
  stop: () => Promise<string>;
}

async function startCommand(args: string[], environment: Record<string, string>): Promise<RunningCommand> {
  const child = Bun.spawn([process.execPath, entryPoint, "--port", "0", ...args], {
    // HOME is replaced so a test can never read or write the real ~/.ultra-learner.
    env: { ...process.env, HOME: await temporaryDirectory(), ...environment },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = new Response(child.stderr).text();
  const stop = async (): Promise<string> => {
    child.kill();
    await child.exited;
    return stderr;
  };
  let output = "";
  for await (const chunk of child.stdout) {
    output += new TextDecoder().decode(chunk);
    const url = output.match(/ready at (\S+)/)?.[1];
    if (url) return { url: new URL(url), stop };
  }
  throw new Error(`The command did not start: ${output}\n${await stop()}`);
}

async function uploadPdf(url: URL): Promise<string> {
  const response = await fetch(new URL("/api/sessions", url), {
    method: "POST",
    headers: { "Content-Type": "application/pdf", "X-Ultra-Learner-Filename": "notes.pdf" },
    body: new TextEncoder().encode("%PDF-1.7\ncommand fixture\n%%EOF\n"),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { session: { id: string } }).session.id;
}

async function listedSessionIds(url: URL): Promise<string[]> {
  const response = await fetch(new URL("/api/sessions", url));
  return ((await response.json()) as { sessions: { id: string }[] }).sessions.map((session) => session.id);
}

describe("ultra-learner command", () => {
  test("starts on loopback without a warning when no address is chosen", async () => {
    const home = await temporaryDirectory();
    const command = await startCommand([], { HOME: home });
    try {
      expect(command.url.hostname).toBe("127.0.0.1");
      const id = await uploadPdf(command.url);
      expect(await readdir(join(home, ".ultra-learner", "sessions"))).toContain(id);
    } finally {
      expect(await command.stop()).toBe("");
    }
  });

  test("saves and reads sessions in the directory from the flag or the environment", async () => {
    const flagDirectory = join(await temporaryDirectory(), "from-flag");
    const environmentDirectory = join(await temporaryDirectory(), "from-environment");

    const fromFlag = await startCommand(["--data-dir", flagDirectory], { ULTRA_LEARNER_HOME: environmentDirectory });
    let id: string;
    try {
      id = await uploadPdf(fromFlag.url);
    } finally {
      await fromFlag.stop();
    }
    expect(await readdir(join(flagDirectory, "sessions"))).toEqual([id]);
    expect(await Bun.file(join(environmentDirectory, "sessions")).exists()).toBe(false);

    // A later process given the same directory through the environment sees the saved session.
    const fromEnvironment = await startCommand([], { ULTRA_LEARNER_HOME: flagDirectory });
    try {
      expect(await listedSessionIds(fromEnvironment.url)).toEqual([id]);
    } finally {
      await fromEnvironment.stop();
    }
  });

  test("fails to start with an empty data directory", async () => {
    const child = Bun.spawn([process.execPath, entryPoint, "--port", "0"], {
      env: { ...process.env, HOME: await temporaryDirectory(), ULTRA_LEARNER_HOME: "" },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await child.exited).toBe(1);
    expect(await new Response(child.stderr).text()).toBe("ULTRA_LEARNER_HOME must name a directory.\n");
    expect(await new Response(child.stdout).text()).toBe("");
  });

  test("binds a chosen address and warns when it is reachable from other machines", async () => {
    const loopback = await startCommand(["--host", "localhost"], {});
    try {
      expect(loopback.url.hostname).toBe("localhost");
      expect((await fetch(new URL("/health", loopback.url))).status).toBe(200);
    } finally {
      expect(await loopback.stop()).toBe("");
    }

    const everywhere = await startCommand(["--host", "0.0.0.0"], {});
    try {
      // The printed address is one the browser can open and the host check accepts.
      expect(everywhere.url.hostname).toBe("127.0.0.1");
      expect((await fetch(new URL("/health", everywhere.url))).status).toBe(200);
    } finally {
      const warning = await everywhere.stop();
      expect(warning).toContain("listening on 0.0.0.0 and has no authentication");
      expect(warning).toContain("docs/deployment.md");
    }
  });
});
