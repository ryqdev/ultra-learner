import assert from "node:assert/strict";
import { appendFile } from "node:fs/promises";
import { name } from "../package.json";

export const registry = "https://registry.npmjs.org/";
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validateVersion(version: unknown): asserts version is string {
  assert.ok(typeof version === "string" && version.trim() === version && stableVersion.test(version),
    "Only stable versions can publish to latest");
}

export function validatePackage(pkg: unknown, tag: unknown): asserts pkg is { name: string; version: string } {
  assert.ok(record(pkg) && pkg.name === name, "Unexpected package name");
  validateVersion(pkg.version);
  assert.equal(tag, `v${pkg.version}`, "Release tag must match package.json version");
}

// Retrying an existing version must not upload again or move latest backwards.
export function planRelease(pkg: unknown, tag: unknown, metadata: unknown): { version: string; publish: boolean } {
  validatePackage(pkg, tag);
  assert.ok(record(metadata) && metadata.name === name, "Unexpected npm registry response");
  const versions = metadata.versions;
  assert.ok(record(versions), "Missing npm versions");
  if (Object.hasOwn(versions, pkg.version)) {
    const published = versions[pkg.version];
    assert.ok(record(published) && published.name === name && published.version === pkg.version, "Invalid published version");
    return { version: pkg.version, publish: false };
  }

  const tags = metadata["dist-tags"];
  assert.ok(record(tags), "Missing npm dist-tags");
  const latest = tags.latest;
  validateVersion(latest);
  const published = versions[latest];
  assert.ok(record(published) && published.name === name && published.version === latest, "Missing latest version metadata");
  const candidateParts = pkg.version.split(".").map(BigInt);
  const latestParts = latest.split(".").map(BigInt);
  const changed = candidateParts.findIndex((part, index) => part !== latestParts[index]);
  assert.ok(changed >= 0 && candidateParts[changed]! > latestParts[changed]!,
    `Refusing to move latest from ${latest} back to ${pkg.version}`);
  return { version: pkg.version, publish: true };
}

export async function readRegistry(fetcher: Fetcher = fetch): Promise<unknown> {
  const response = await fetcher(new URL(encodeURIComponent(name), registry), {
    signal: AbortSignal.timeout(30_000), redirect: "error", headers: { "Cache-Control": "no-cache" },
  });
  assert.ok(response.ok, response.status === 404
    ? "npm package not found (HTTP 404). Complete the first authenticated publish and Trusted Publisher setup in docs/releasing.md."
    : `Cannot read npm metadata: HTTP ${response.status}`);
  return response.json();
}

if (import.meta.main) {
  const pkg: unknown = await Bun.file("package.json").json();
  validatePackage(pkg, process.env.RELEASE_TAG);
  const plan = planRelease(pkg, process.env.RELEASE_TAG, await readRegistry());
  console.log(`${name}@${plan.version}: ${plan.publish ? "ready to publish" : "already published; skip upload"}`);
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `version=${plan.version}\npublish=${plan.publish}\n`);
  }
}
