import assert from "node:assert/strict";
import { appendFile } from "node:fs/promises";
import { name, version } from "../package.json";

const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
type RegistryFetcher = (url: string, options: RequestInit) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function planRelease(pkg: { name: string; version: string }, tag: string | undefined, metadata: unknown) {
  assert.equal(pkg.name, name, "Unexpected package name");
  assert.match(pkg.version, stableVersion, "Only stable versions can publish to latest");
  assert.equal(tag, `v${pkg.version}`, "Release tag must match package.json version");
  assert.ok(isRecord(metadata) && metadata.name === name, "Unexpected npm registry response");
  const versions = metadata.versions;
  assert.ok(isRecord(versions), "Missing npm versions");
  if (Object.hasOwn(versions, pkg.version)) {
    const published = versions[pkg.version];
    assert.ok(isRecord(published) && published.version === pkg.version, "Invalid published version");
    return { version: pkg.version, publish: false };
  }

  const tags = metadata["dist-tags"];
  assert.ok(isRecord(tags) && typeof tags.latest === "string", "Missing npm latest tag");
  const latest = tags.latest;
  assert.match(latest, stableVersion, "The npm latest tag must identify a stable version");
  const latestMetadata = versions[latest];
  assert.ok(isRecord(latestMetadata) && latestMetadata.version === latest, "Missing latest version metadata");
  const candidateParts = pkg.version.split(".").map(BigInt);
  const latestParts = latest.split(".").map(BigInt);
  const changedPart = candidateParts.findIndex((part, index) => part !== latestParts[index]);
  assert.ok(changedPart >= 0 && candidateParts[changedPart]! > latestParts[changedPart]!,
    `Refusing to move latest from ${latest} back to ${pkg.version}`);
  return { version: pkg.version, publish: true };
}

export async function readRegistry(fetcher: RegistryFetcher = fetch): Promise<unknown> {
  const response = await fetcher(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
    signal: AbortSignal.timeout(30_000),
    headers: { "Cache-Control": "no-cache" },
  });
  assert.notEqual(response.status, 404,
    "The npm package does not exist. Complete the first publish and Trusted Publisher setup in docs/releasing.md, then retry this tag.");
  assert.ok(response.ok, `Cannot read npm metadata: HTTP ${response.status}`);
  return response.json();
}

if (import.meta.main) {
  const plan = planRelease({ name, version }, process.env.RELEASE_TAG, await readRegistry());
  console.log(`${name}@${version}: ${plan.publish ? "ready to publish" : "already published; skip upload"}`);
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `version=${plan.version}\npublish=${plan.publish}\n`);
  }
}
