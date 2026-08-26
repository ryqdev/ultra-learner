import { afterEach, describe, expect, test } from "bun:test";

import { createAppServer } from "../src/server.ts";

let server: ReturnType<typeof createAppServer> | undefined;

afterEach(() => {
  server?.stop(true);
  server = undefined;
});

describe("web server", () => {
  test("serves the application and health endpoint", async () => {
    server = createAppServer({ port: 0, development: false });

    const pageResponse = await fetch(server.url);
    const page = await pageResponse.text();
    expect(pageResponse.status).toBe(200);
    expect(pageResponse.headers.get("content-type")).toContain("text/html");
    expect(page).toContain("Ultra Learner");
    expect(page).toContain("Choose PDF");
    expect(page).toContain('id="chat-panel"');
    expect(page).toContain('id="chat-resize-handle"');
    expect(page).toContain('role="separator"');
    expect(page).toContain('id="chat-config-form"');
    expect(page).toContain('id="text-layer"');

    const healthResponse = await fetch(new URL("/health", server.url));
    expect(await healthResponse.json()).toEqual({ status: "ok" });
  });

  test("builds the browser entry and rejects unsupported methods", async () => {
    server = createAppServer({ port: 0, development: false });

    const appResponse = await fetch(new URL("/assets/app.js", server.url));
    expect(appResponse.status).toBe(200);
    expect(appResponse.headers.get("content-type")).toContain("text/javascript");
    expect((await appResponse.text()).length).toBeGreaterThan(100_000);

    const postResponse = await fetch(server.url, { method: "POST" });
    expect(postResponse.status).toBe(405);
  });

  test("does not expose files outside the public directory", async () => {
    server = createAppServer({ port: 0, development: false });
    const response = await fetch(new URL("/../package.json", server.url));
    expect(response.status).toBe(404);
  });

  test("serves PDF worker resources with browser-safe content types", async () => {
    server = createAppServer({ port: 0, development: false });

    const workerResponse = await fetch(new URL("/assets/pdf.worker.mjs", server.url));
    expect(workerResponse.status).toBe(200);
    expect(workerResponse.headers.get("content-type")).toContain("text/javascript");

    const wasmResponse = await fetch(new URL("/assets/wasm/openjpeg.wasm", server.url));
    expect(wasmResponse.status).toBe(200);
    expect(wasmResponse.headers.get("content-type")).toBe("application/wasm");
  });
});
