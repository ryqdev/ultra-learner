import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { name, version } from "../package.json";
import { consumerEnvironment, run, smokePackage } from "./smoke-package.ts";

const root = resolve(import.meta.dir, "..");
const temporary = await mkdtemp(join(tmpdir(), "ultra-learner-package-"));
try {
  const tarball = join(temporary, "package.tgz");
  await run([process.execPath, "pm", "pack", "--filename", tarball], root);
  const entries = (await run(["tar", "-tzf", tarball], root)).trim().split("\n");
  for (const path of entries) {
    assert.match(path, /^package\/(?:src\/|public\/|docs\/architecture\.md$|package\.json$|README\.md$|LICENSE$)/,
      `Unexpected file in npm package: ${path}`);
  }
  for (const path of ["package.json", "LICENSE", "src/index.ts", "src/server.ts", "src/web/app.ts", "public/index.html"]) {
    assert.ok(entries.includes(`package/${path}`), `Missing ${path}`);
  }
  const consumer = join(temporary, "consumer");
  await mkdir(consumer);
  await Bun.write(join(consumer, "package.json"), JSON.stringify({ private: true, dependencies: { [name]: `file:${tarball}` } }));
  const env = consumerEnvironment(join(temporary, "cache"));
  await run([process.execPath, "install", "--ignore-scripts", "--linker=hoisted"], consumer, env);
  assert.equal(await Bun.file(join(consumer, "node_modules", name, "node_modules/pdfjs-dist/package.json")).exists(), false,
    "The package smoke test must exercise hoisted PDF.js assets");
  const unrelatedDirectory = join(consumer, "unrelated");
  await mkdir(unrelatedDirectory);
  await smokePackage(unrelatedDirectory, name, version, env);
  const output = Bun.argv[2];
  if (output) await copyFile(tarball, resolve(output));
  console.log(`Verified ${name}@${version}: package contents, bunx CLI, browser bundle, and PDF.js assets.`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
