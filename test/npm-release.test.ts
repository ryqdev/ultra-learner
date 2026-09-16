import { describe, expect, test } from "bun:test";
import { name } from "../package.json";
import { planRelease, readRegistry } from "../scripts/check-npm-release.ts";

function registry(latest = "0.1.0") {
  return { name, versions: { [latest]: { version: latest } }, "dist-tags": { latest } };
}

describe("npm release plan", () => {
  test("allows increasing patch, minor, and major stable versions", () => {
    for (const version of ["0.1.1", "0.2.0", "1.0.0"]) {
      expect(planRelease({ name, version }, `v${version}`, registry())).toEqual({ version, publish: true });
    }
    expect(planRelease({ name, version: "0.10.0" }, "v0.10.0", registry("0.9.0")).publish).toBe(true);
  });

  test("retries an existing version without uploading or moving latest", () => {
    const metadata = registry("0.2.0");
    metadata.versions["0.1.0"] = { version: "0.1.0" };
    expect(planRelease({ name, version: "0.1.0" }, "v0.1.0", metadata)).toEqual({ version: "0.1.0", publish: false });
  });

  test("rejects a new version below latest", () => {
    expect(() => planRelease({ name, version: "0.1.1" }, "v0.1.1", registry("0.2.0"))).toThrow("Refusing");
  });

  test("rejects mismatched tags, package names, and non-stable versions", () => {
    expect(() => planRelease({ name, version: "0.1.1" }, "v0.1.2", registry())).toThrow("Release tag");
    expect(() => planRelease({ name: "other", version: "0.1.1" }, "v0.1.1", registry())).toThrow("package name");
    for (const version of ["0.1.1-beta.1", "01.1.1", "0.1", "0.1.1+build"]) {
      expect(() => planRelease({ name, version }, `v${version}`, registry())).toThrow("stable versions");
    }
  });

  test("rejects incomplete or malformed registry metadata", () => {
    for (const metadata of [null, {}, { ...registry(), name: "other" }, { ...registry(), versions: [] },
      { ...registry(), "dist-tags": {} }, registry("0.1.0-beta.1"), { ...registry(), versions: {} },
      { ...registry(), versions: { "0.1.1": { version: "other" } } }]) {
      expect(() => planRelease({ name, version: "0.1.1" }, "v0.1.1", metadata)).toThrow();
    }
  });
});

describe("npm registry reads", () => {
  test("reads the exact package from the public registry", async () => {
    const metadata = await readRegistry(async (url, options) => {
      expect(url).toBe(`https://registry.npmjs.org/${encodeURIComponent(name)}`);
      expect(options.signal).toBeInstanceOf(AbortSignal);
      return Response.json(registry());
    });
    expect(metadata).toEqual(registry());
  });

  test("explains the first-publication bootstrap on 404", async () => {
    await expect(readRegistry(async () => new Response(null, { status: 404 }))).rejects.toThrow("first publish");
  });

  test("does not treat auth, server, network, or JSON errors as permission to publish", async () => {
    for (const status of [401, 403, 429, 500]) {
      await expect(readRegistry(async () => new Response(null, { status }))).rejects.toThrow(`HTTP ${status}`);
    }
    await expect(readRegistry(async () => { throw new Error("network failure"); })).rejects.toThrow("network failure");
    await expect(readRegistry(async () => new Response("not JSON"))).rejects.toThrow();
  });
});
