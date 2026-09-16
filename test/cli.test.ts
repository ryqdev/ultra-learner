import { describe, expect, test } from "bun:test";
import { parseCliArguments } from "../src/cli.ts";

describe("CLI options", () => {
  test("uses the default port, environment, and explicit override", () => {
    expect(parseCliArguments([])).toEqual({ mode: "serve", port: 8881 });
    expect(parseCliArguments([], "4100")).toEqual({ mode: "serve", port: 4100 });
    expect(parseCliArguments(["--port", "4200"], "4100")).toEqual({ mode: "serve", port: 4200 });
    expect(parseCliArguments(["--port", "0"])).toEqual({ mode: "serve", port: 0 });
  });

  test("help and version do not depend on the server configuration", () => {
    for (const flag of ["--help", "-h"]) expect(parseCliArguments([flag], "bad")).toEqual({ mode: "help" });
    for (const flag of ["--version", "-v"]) expect(parseCliArguments([flag], "bad")).toEqual({ mode: "version" });
  });

  test("rejects unsupported arguments and invalid ports before starting a server", () => {
    for (const args of [["--unknown"], ["--port"], ["--port", "80", "extra"], ["--help", "extra"]]) {
      expect(() => parseCliArguments(args)).toThrow("Expected");
    }
    for (const port of ["", "abc", "-1", "1.5", "65536", "Infinity", "1e3", " 80"]) {
      expect(() => parseCliArguments(["--port", port])).toThrow("Port must");
      expect(() => parseCliArguments([], port)).toThrow("Port must");
    }
  });
});
