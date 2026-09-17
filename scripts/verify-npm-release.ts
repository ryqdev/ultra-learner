import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { name } from "../package.json";
import { planRelease, readRegistry, record, registry, validateVersion } from "./check-npm-release.ts";
import { consumerEnvironment, run, smokePackage } from "./smoke-package.ts";

const version = process.env.VERSION;
validateVersion(version);
for (let attempt = 1; ; attempt++) {
  try {
    const metadata = await readRegistry();
    assert.equal(planRelease({ name, version }, `v${version}`, metadata).publish, false, "Version is not yet visible on npm");
    if (process.env.PUBLISHED === "true") {
      assert.ok(record(metadata) && record(metadata["dist-tags"]) && metadata["dist-tags"].latest === version,
        "The new version is not npm latest");
    }
    break;
  } catch (error) {
    if (attempt === 6) throw error;
    await Bun.sleep(10_000);
  }
}

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
