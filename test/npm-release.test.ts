import { describe, expect, test } from "bun:test";
import { name } from "../package.json";
import { planRelease, readRegistry, type Fetcher } from "../scripts/check-npm-release.ts";
import { exchangePublishToken } from "../scripts/publish-npm.ts";

const pkg = (version: string) => ({ name, version });
const metadata = (latest: string, versions = [latest]) => ({
  name,
  "dist-tags": { latest },
  versions: Object.fromEntries(versions.map((version) => [version, { name, version }])),
});

describe("npm release planning", () => {
  test("new patch, minor, and major releases advance latest numerically", () => {
    for (const [version, latest] of [["0.1.10", "0.1.9"], ["0.10.0", "0.9.9"], ["1.0.0", "0.9.9"]] as const) {
      expect(planRelease(pkg(version), `v${version}`, metadata(latest))).toEqual({ version, publish: true });
    }
  });

  test("retries skip existing versions without moving latest", () => {
    expect(planRelease(pkg("0.1.1"), "v0.1.1", metadata("0.1.1"))).toEqual({ version: "0.1.1", publish: false });
    expect(planRelease(pkg("0.1.1"), "v0.1.1", metadata("0.2.0", ["0.1.1", "0.2.0"])))
      .toEqual({ version: "0.1.1", publish: false });
  });

  test("unpublished older tags cannot downgrade latest", () => {
    expect(() => planRelease(pkg("0.1.1"), "v0.1.1", metadata("0.2.0"))).toThrow("Refusing to move latest");
  });

  test("the tag and package identity must agree with the release", () => {
    expect(() => planRelease(pkg("0.1.1"), "v0.1.2", metadata("0.1.0"))).toThrow("must match");
    expect(() => planRelease({ name: "other", version: "0.1.1" }, "v0.1.1", metadata("0.1.0"))).toThrow("Unexpected package");
    expect(() => planRelease(null, "v0.1.1", metadata("0.1.0"))).toThrow("Unexpected package");
  });

  test("prereleases, build metadata, and noncanonical versions cannot reach latest", () => {
    for (const version of ["0.1.1-rc.1", "0.1.1+build", "00.1.1", "0.1", "v0.1.1", "0.1.1\n", "0.1.1\npublish=true"]) {
      expect(() => planRelease(pkg(version), `v${version}`, metadata("0.1.0"))).toThrow("Only stable versions");
    }
  });

  test("invalid registry responses cannot authorize a publish or a successful retry", () => {
    for (const data of [null, [], {}, { ...metadata("0.1.0"), name: "other" }, { name, versions: [] },
      { name, versions: {} }, metadata("0.1.0-rc.1"), metadata("0.1.0", []),
      { ...metadata("0.1.1"), versions: { "0.1.1": { name, version: "0.1.2" } } }]) {
      expect(() => planRelease(pkg("0.1.1"), "v0.1.1", data)).toThrow();
    }
  });

  test("a missing package requires explicit first-publish setup", async () => {
    await expect(readRegistry(async () => new Response("Not found", { status: 404 }))).rejects.toThrow("first authenticated publish");
  });

  test("registry failures are never interpreted as an unpublished version", async () => {
    for (const status of [401, 403, 429, 500]) {
      await expect(readRegistry(async () => new Response("unavailable", { status }))).rejects.toThrow(`HTTP ${status}`);
    }
    await expect(readRegistry(async () => { throw new Error("network unavailable"); })).rejects.toThrow("network unavailable");
    await expect(readRegistry(async () => new Response("invalid json"))).rejects.toThrow();
    expect(await readRegistry(async () => Response.json(metadata("0.1.0")))).toEqual(metadata("0.1.0"));
  });
});

const oidcEnvironment = {
  GITHUB_ACTIONS: "true",
  ACTIONS_ID_TOKEN_REQUEST_URL: "https://example.actions.githubusercontent.com/token?api-version=2.0",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "test-runner-credential",
};

describe("npm trusted publishing", () => {
  test("exchanges the workflow identity for a package-scoped npm token", async () => {
    const requests: { url: URL; init: RequestInit | undefined }[] = [];
    const fetcher: Fetcher = async (input, init) => {
      requests.push({ url: new URL(input), init });
      return requests.length === 1
        ? Response.json({ value: "test-oidc-identity" })
        : Response.json({ token_type: "oidc", token: "test-npm-credential" }, { status: 201 });
    };
    expect(await exchangePublishToken(oidcEnvironment, fetcher)).toBe("test-npm-credential");
    expect(requests).toHaveLength(2);
    expect(requests[0]!.url.searchParams.get("audience")).toBe("npm:registry.npmjs.org");
    expect(requests[0]!.url.searchParams.get("api-version")).toBe("2.0");
    expect(new Headers(requests[0]!.init?.headers).get("Authorization")).toBe("Bearer test-runner-credential");
    expect(requests[1]!.url.href).toBe(`https://registry.npmjs.org/-/npm/v1/oidc/token/exchange/package/${encodeURIComponent(name)}`);
    expect(requests[1]!.init?.method).toBe("POST");
    expect(new Headers(requests[1]!.init?.headers).get("Authorization")).toBe("Bearer test-oidc-identity");
    expect(requests.every(({ init }) => init?.redirect === "error" && init.signal instanceof AbortSignal)).toBe(true);
  });

  test("missing workflow credentials stop before any network request", async () => {
    let calls = 0;
    const fetcher: Fetcher = async () => { calls++; return Response.json({}); };
    for (const env of [{}, { ...oidcEnvironment, GITHUB_ACTIONS: "false" },
      { ...oidcEnvironment, ACTIONS_ID_TOKEN_REQUEST_TOKEN: "" },
      { ...oidcEnvironment, ACTIONS_ID_TOKEN_REQUEST_URL: "http://example.com/token" }]) {
      await expect(exchangePublishToken(env, fetcher)).rejects.toThrow();
    }
    expect(calls).toBe(0);
  });

  test("failed or invalid GitHub identities never reach npm", async () => {
    for (const response of [new Response("private detail", { status: 403 }), Response.json({}),
      Response.json({ value: "" }), Response.json({ value: "test\nidentity" }), Response.json({ value: "test-identity\n" })]) {
      let calls = 0;
      await expect(exchangePublishToken(oidcEnvironment, async () => { calls++; return response; })).rejects.toThrow();
      expect(calls).toBe(1);
    }
  });

  test("failed npm exchanges cannot fall back to another credential", async () => {
    for (const response of [new Response("private detail", { status: 401 }),
      new Response("private detail", { status: 404 }), Response.json({}),
      Response.json({ token_type: "oidc", token: "" }), Response.json({ token_type: "oidc", token: "test-token\n" }),
      Response.json({ token_type: "other", token: "test-token" })]) {
      let calls = 0;
      await expect(exchangePublishToken(oidcEnvironment, async () => ++calls === 1
        ? Response.json({ value: "test-identity" }) : response)).rejects.toThrow();
    }
  });
});
