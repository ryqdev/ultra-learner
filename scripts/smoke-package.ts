import assert from "node:assert/strict";
import { delimiter, dirname } from "node:path";

export function consumerEnvironment(cache: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ""}`,
    BUN_INSTALL_CACHE_DIR: cache,
    NODE_ENV: "production",
  };
}

export async function run(command: string[], cwd: string, env = process.env): Promise<string> {
  const child = Bun.spawn(command, { cwd, env, stdout: "pipe", stderr: "pipe", timeout: 120_000 });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  assert.equal(code, 0, `${command.join(" ")} failed (${code}):\n${stdout}\n${stderr}`);
  return stdout;
}

export async function smokePackage(cwd: string, name: string, version: string, env: NodeJS.ProcessEnv, allowInstall = false): Promise<void> {
  // Exercise bunx's bin lookup and the package's Bun shebang without --bun.
  const command = [process.execPath, "x", ...(allowInstall ? [] : ["--no-install"]), "--package", name, "ultra-learner"];
  assert.equal((await run([...command, "--version"], cwd, env)).trim(), version);
  assert.match(await run([...command, "--help"], cwd, env), /Usage: ultra-learner/);

  const child = Bun.spawn([...command, "--port", "0"], {
    cwd, env, stdout: "pipe", stderr: "pipe", timeout: 60_000,
  });
  const stderr = new Response(child.stderr).text();
  try {
    let output = "";
    let baseUrl: string | undefined;
    for await (const chunk of child.stdout) {
      output += new TextDecoder().decode(chunk);
      baseUrl = output.match(/ready at (http:\/\/127\.0\.0\.1:\d+\/)/)?.[1];
      if (baseUrl) break;
    }
    if (!baseUrl) throw new Error(`The installed CLI did not start: ${output}\n${await stderr}`);
    const health = await fetch(new URL("/health", baseUrl), { signal: AbortSignal.timeout(10_000) });
    assert.deepEqual(await health.json(), { status: "ok" });
    for (const [path, type, minimumSize] of [
      ["/", "text/html", 1000],
      ["/styles.css", "text/css", 1000],
      ["/assets/app.js", "text/javascript", 100_000],
      ["/assets/pdf.worker.mjs", "text/javascript", 100_000],
      ["/assets/pdf_viewer.css", "text/css", 1000],
      ["/assets/standard_fonts/FoxitFixedBold.pfb", "application/octet-stream", 1000],
      ["/assets/wasm/qcms_bg.wasm", "application/wasm", 1000],
    ] as const) {
      const response: Response = await fetch(new URL(path, baseUrl), { signal: AbortSignal.timeout(30_000) });
      assert.equal(response.status, 200, path);
      assert.ok(response.headers.get("content-type")?.includes(type), `${path}: content type`);
      assert.ok((await response.arrayBuffer()).byteLength > minimumSize, `${path}: empty or incomplete asset`);
    }
    const missing = await fetch(new URL("/assets/standard_fonts/missing.pfb", baseUrl));
    assert.equal(missing.status, 404);
  } finally {
    child.kill();
    await child.exited;
    await stderr;
  }
}
