import assert from "node:assert/strict";
import { resolve } from "node:path";
import { name } from "../package.json";
import { planRelease, readRegistry, record, registry, type Fetcher } from "./check-npm-release.ts";

export async function exchangePublishToken(env: NodeJS.ProcessEnv, fetcher: Fetcher = fetch): Promise<string> {
  assert.ok(env.GITHUB_ACTIONS === "true" && env.ACTIONS_ID_TOKEN_REQUEST_URL && env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
    "Publishing requires GitHub Actions with id-token: write");
  const url = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
  assert.equal(url.protocol, "https:", "The GitHub OIDC endpoint must use HTTPS");
  url.searchParams.set("audience", "npm:registry.npmjs.org");
  const identity = await fetcher(url, {
    headers: { Authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
    signal: AbortSignal.timeout(30_000), redirect: "error",
  });
  assert.ok(identity.ok, `GitHub OIDC request failed: HTTP ${identity.status}`);
  const claims: unknown = await identity.json();
  assert.ok(record(claims) && typeof claims.value === "string" && claims.value.length > 0 && !/\s/.test(claims.value),
    "Invalid GitHub OIDC response");
  const response = await fetcher(new URL(`-/npm/v1/oidc/token/exchange/package/${encodeURIComponent(name)}`, registry), {
    method: "POST", headers: { Authorization: `Bearer ${claims.value}` },
    signal: AbortSignal.timeout(30_000), redirect: "error",
  });
  assert.ok(response.ok, `npm OIDC exchange failed: HTTP ${response.status}. Check the Trusted Publisher configuration.`);
  const credential: unknown = await response.json();
  assert.ok(record(credential) && credential.token_type === "oidc"
    && typeof credential.token === "string" && credential.token.length > 0 && !/\s/.test(credential.token),
    "Invalid npm OIDC response");
  return credential.token;
}

if (import.meta.main) {
  const archive = Bun.argv[2];
  assert.ok(archive && await Bun.file(archive).exists(), "Provide the archive verified by test:package");
  const plan = planRelease(await Bun.file("package.json").json(), process.env.RELEASE_TAG, await readRegistry());
  if (plan.publish) {
    // Keep the short-lived credential out of files, step outputs, and command arguments.
    const token = await exchangePublishToken(process.env);
    console.log(`::add-mask::${token}`);
    const child = Bun.spawn([
      process.execPath, "publish", resolve(archive), "--access", "public", "--tag", "latest",
      "--registry", registry, "--ignore-scripts",
    ], { env: { ...process.env, NPM_CONFIG_TOKEN: token }, stdin: "ignore", stdout: "inherit", stderr: "inherit" });
    assert.equal(await child.exited, 0, "npm publication failed");
  } else {
    console.log(`${name}@${plan.version} is already published; skip upload.`);
  }
}
