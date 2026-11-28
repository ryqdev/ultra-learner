import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { name } from "../package.json";
import { planRelease, readRegistry, record, registry, validateVersion } from "./check-npm-release.ts";
import { consumerEnvironment, run, smokePackage } from "./smoke-package.ts";

// npm accepts an upload before its registry metadata lists the version, often for more than a minute.
export const visibilityTimeoutMs = 5 * 60_000;
const visibilityIntervalMs = 10_000;

type Visibility = {
  read?: () => Promise<unknown>;
  sleep?: (ms: number) => Promise<unknown>;
  now?: () => number;
};

export async function waitForVisibleRelease(version: string, published: boolean,
  { read = readRegistry, sleep = Bun.sleep, now = Date.now }: Visibility = {}): Promise<void> {
  const deadline = now() + visibilityTimeoutMs;
  for (;;) {
    try {
      const metadata = await read();
      assert.equal(planRelease({ name, version }, `v${version}`, metadata).publish, false, "Version is not yet visible on npm");
      if (published) {
        assert.ok(record(metadata) && record(metadata["dist-tags"]) && metadata["dist-tags"].latest === version,
          "The new version is not npm latest");
      }
      return;
    } catch (error) {
      if (now() + visibilityIntervalMs > deadline) {
        throw new Error(`${name}@${version} was not visible as expected on npm after ${visibilityTimeoutMs / 60_000} minutes: ${
          error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
      await sleep(visibilityIntervalMs);
    }
  }
}

if (import.meta.main) {
  const version = process.env.VERSION;
  validateVersion(version);
  await waitForVisibleRelease(version, process.env.PUBLISHED === "true");

  const temporary = await mkdtemp(join(tmpdir(), "ultra-learner-published-"));
  try {
    const env = consumerEnvironment(join(temporary, "cache"));
    await Bun.write(join(temporary, "package.json"), JSON.stringify({ private: true, dependencies: { [name]: version } }));
    await run([process.execPath, "install", "--ignore-scripts", "--linker=hoisted", "--registry", registry], temporary, env);
    const unrelated = join(temporary, "unrelated");
    await mkdir(unrelated);
    await smokePackage(unrelated, name, version, env);
    const summary = `Verified ${name}@${version} from npm: bunx, server, browser bundle, and PDF.js assets.\n`;
    console.log(summary.trim());
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
