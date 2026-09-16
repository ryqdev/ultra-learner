import assert from "node:assert/strict";
import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { name, version } from "../package.json";
import { planRelease, readRegistry } from "./check-npm-release.ts";
import { consumerEnvironment, smokePackage } from "./smoke-package.ts";

let verified = false;
for (let attempt = 0; attempt < 6; attempt += 1) {
  const metadata = await readRegistry();
  if (!planRelease({ name, version }, `v${version}`, metadata).publish) {
    if (process.env.PUBLISHED === "true") {
      assert.equal((metadata as { "dist-tags": { latest: string } })["dist-tags"].latest, version);
    }
    verified = true;
    break;
  }
  if (attempt < 5) await Bun.sleep(10_000);
}
assert.ok(verified, `npm did not expose ${name}@${version} after publication`);

const consumer = await mkdtemp(join(tmpdir(), "ultra-learner-published-"));
try {
  await Bun.write(join(consumer, "package.json"), '{"private":true}\n');
  await smokePackage(consumer, `${name}@${version}`, version, consumerEnvironment(join(consumer, "cache")), true);
  const message = `Verified ${name}@${version} from npm with a fresh bunx cache (new upload: ${process.env.PUBLISHED === "true"}).`;
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
} finally {
  await rm(consumer, { recursive: true, force: true });
}
