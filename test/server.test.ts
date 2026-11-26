import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import path from "node:path";

import { createAppServer, resolveContainedPath } from "../src/server.ts";
import { CHAT_MODELS_PATH, CHAT_TEST_PATH, CHAT_TEST_MESSAGE } from "../src/lib/chat.ts";

let server: ReturnType<typeof createAppServer> | undefined;
const sessionRoots: string[] = [];

afterEach(async () => {
  server?.stop(true);
  server = undefined;
  await Promise.all(sessionRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function sessionRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ultra-learner-server-"));
  sessionRoots.push(root);
  return root;
}

/** Create a minimal application root whose browser entry the test controls. */
async function applicationRoot(entrySource: string): Promise<{ root: string; entry: string }> {
  const root = await sessionRoot();
  await mkdir(join(root, "public"));
  await mkdir(join(root, "src", "web"), { recursive: true });
  const entry = join(root, "src", "web", "app.ts");
  await writeFile(entry, entrySource);
  return { root, entry };
}

describe("web server", () => {
  test("serves the application and health endpoint", async () => {
    server = createAppServer({ port: 0, development: false, sessionRoot: await sessionRoot() });

    const pageResponse = await fetch(server.url);
    const page = await pageResponse.text();
    expect(pageResponse.status).toBe(200);
    expect(pageResponse.headers.get("content-type")).toContain("text/html");
    expect(page).toContain("Ultra Learner");
    for (const removedCopy of [
      "A focused space for deep reading",
      "Bring your PDF into a quiet, considered reading space",
      "Not ready with a PDF?",
      "Local library",
      "On this device",
      "Built for curious minds.",
      "Your files stay local.",
      "Read with intention",
      ">Workspace<",
      'id="topbar-title">Library',
    ]) {
      expect(page).not.toContain(removedCopy);
    }
    expect(page).not.toContain('id="sample-button"');
    expect(page).not.toContain('id="site-footer"');
    expect(page).toContain("Choose PDF");
    expect(page).toContain('class="reader-view chat-collapsed" id="reader-view"');
    expect(page).toContain('class="chat-panel is-collapsed" id="chat-panel"');
    expect(page).toContain('id="chat-resize-handle"');
    expect(page).toContain('role="separator"');
    expect(page).toContain('id="chat-config-form"');
    expect(page).toContain('<form class="chat-config-form" id="chat-config-form">');
    expect(page).toContain('id="chat-profile-name"');
    expect(page).toContain('id="chat-provider-preset"');
    expect(page).toContain('id="chat-api-key-toggle"');
    expect(page).toContain('id="chat-fetch-models"');
    expect(page).toContain('id="chat-model"');
    expect(page).toContain('id="chat-reasoning-effort"');
    expect(page).toContain('id="chat-config-summary"');
    expect(page).toContain("Model configuration");
    expect(page).toContain('class="ai-panel-trigger"');
    expect(page).toContain('aria-label="Open AI guide" aria-controls="chat-panel" aria-expanded="false"');
    expect(page).toContain('aria-controls="chat-panel"');
    expect(page).toContain("Save &amp; use model");
    expect(page).toContain("Ollama · local");
    expect(page).toContain('data-placeholder="true"');
    expect(page).not.toContain('id="new-session-button"');
    expect(page).not.toContain('id="new-file-button"');
    expect(page).not.toContain('id="sidebar-new-chat"');
    expect(page).not.toContain('id="chat-message-list"');
    expect(page).not.toContain('id="chat-composer"');
    expect(page).not.toContain('id="chat-selection-card"');
    expect(page).not.toContain("Study companion");
    expect(page).not.toContain("Ask this PDF");
    expect(page).not.toContain("Ask the page.");
    expect(page).toContain('id="text-layer"');
    expect(page).toContain('class="textLayer" id="text-layer" tabindex="0"');
    expect(page).not.toContain('id="document-meta"');
    expect(page).toContain('id="app-sidebar"');
    expect(page).toContain('id="app-sidebar-toggle"');
    expect(page).not.toContain('id="sidebar-open-pdf"');
    expect(page).not.toContain(">Open PDF<");
    expect(page).toContain('id="history-list"');
    expect(page).toContain('id="session-delete-dialog"');
    expect(page).toContain('aria-labelledby="session-delete-title"');
    expect(page).toContain('id="session-delete-filename"');
    expect(page).toContain('id="session-delete-cancel" type="button"');
    expect(page).toContain('id="session-delete-confirm" type="button"');
    expect(page).toContain("~/.ultra-learner");
    expect(page).toContain('id="annotation-layer"');
    expect(page).toContain('/assets/pdf_viewer.css');
    expect(page).toContain('class="loader" aria-hidden="true"');
    expect(page).toContain('class="sr-only" id="loading-detail"');
    expect(page).not.toContain("Preparing your reading space");

    const healthResponse = await fetch(new URL("/health", server.url));
    expect(await healthResponse.json()).toEqual({ status: "ok" });
  });

  test("builds the browser entry and rejects unsupported methods", async () => {
    server = createAppServer({ port: 0, development: false, sessionRoot: await sessionRoot() });

    const appResponse = await fetch(new URL("/assets/app.js", server.url));
    expect(appResponse.status).toBe(200);
    expect(appResponse.headers.get("content-type")).toContain("text/javascript");
    const app = await appResponse.text();
    expect(app.length).toBeGreaterThan(100_000);
    expect(app).toContain("core-js");
    expect(app).not.toContain("Your uploaded PDFs will appear here.");

    const postResponse = await fetch(server.url, { method: "POST" });
    expect(postResponse.status).toBe(405);

    const chatTestGetResponse = await fetch(new URL(CHAT_TEST_PATH, server.url));
    expect(chatTestGetResponse.status).toBe(405);
    expect(chatTestGetResponse.headers.get("allow")).toBe("POST");

    const chatModelsGetResponse = await fetch(new URL(CHAT_MODELS_PATH, server.url));
    expect(chatModelsGetResponse.status).toBe(405);
    expect(chatModelsGetResponse.headers.get("allow")).toBe("POST");

    const pageResponse = await fetch(server.url);
    const page = await pageResponse.text();
    expect(page).toContain('id="chat-toggle"');
    expect(page).not.toContain('id="new-session-button"');
  });

  test("builds the browser bundle once unless development mode is requested", async () => {
    const { root, entry } = await applicationRoot('console.log("first build");\n');
    const bundle = async (): Promise<string> => (await fetch(new URL("/assets/app.js", server!.url))).text();

    server = createAppServer({ port: 0, root, sessionRoot: await sessionRoot() });
    expect(server.development).toBe(false);
    expect(await bundle()).toContain("first build");
    await writeFile(entry, 'console.log("second build");\n');
    expect(await bundle()).toContain("first build");

    server.stop(true);
    server = createAppServer({ port: 0, root, development: true, sessionRoot: await sessionRoot() });
    expect(await bundle()).toContain("second build");
    await writeFile(entry, 'console.log("third build");\n');
    expect(await bundle()).toContain("third build");
  });

  test("reports a failed browser build plainly and recovers once the source is fixed", async () => {
    const { root, entry } = await applicationRoot("const = ;\n");
    const logged = spyOn(console, "error").mockImplementation(() => {});
    try {
      server = createAppServer({ port: 0, root, sessionRoot: await sessionRoot() });
      const failed = await fetch(new URL("/assets/app.js", server.url));
      expect(failed.status).toBe(500);
      expect(await failed.text()).toBe("Unable to build the reader");
      expect(logged).toHaveBeenCalled();

      await writeFile(entry, 'console.log("repaired");\n');
      const repaired = await fetch(new URL("/assets/app.js", server.url));
      expect(repaired.status).toBe(200);
      expect(await repaired.text()).toContain("repaired");
    } finally {
      logged.mockRestore();
    }
  });

  test("tests provider settings with a minimal completion through the proxy", async () => {
    let upstreamUrl = "";
    let upstreamInit: RequestInit | undefined;
    server = createAppServer({
      port: 0,
      development: false,
      sessionRoot: await sessionRoot(),
      chatFetcher: async (input, init) => {
        upstreamUrl = String(input);
        upstreamInit = init;
        return Response.json({ choices: [{ message: { content: "OK" } }] });
      },
    });

    const response = await fetch(new URL(CHAT_TEST_PATH, server.url), {
      method: "POST",
      headers: { Authorization: "Bearer tab-secret", "Content-Type": "application/json" },
      body: JSON.stringify({ baseUrl: "https://provider.example/v1", model: "study-model" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ choices: [{ message: { content: "OK" } }] });
    expect(upstreamUrl).toBe("https://provider.example/v1/chat/completions");
    expect(upstreamInit?.headers).toEqual({
      Accept: "application/json",
      Authorization: "Bearer tab-secret",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(upstreamInit?.body))).toEqual({
      model: "study-model",
      messages: [{ role: "user", content: CHAT_TEST_MESSAGE }],
      stream: false,
    });
    expect(String(upstreamInit?.body)).not.toContain("tab-secret");

    const missingKey = await fetch(new URL(CHAT_TEST_PATH, server.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseUrl: "https://provider.example/v1", model: "study-model" }),
    });
    expect(missingKey.status).toBe(401);
  });

  test("forwards model discovery and selected reasoning intensity safely", async () => {
    let upstreamUrl = "";
    let upstreamInit: RequestInit | undefined;
    let upstreamCalls = 0;
    server = createAppServer({
      port: 0,
      development: false,
      sessionRoot: await sessionRoot(),
      chatFetcher: async (input, init) => {
        upstreamCalls += 1;
        upstreamUrl = String(input);
        upstreamInit = init;
        if (upstreamUrl.endsWith("/chat/completions")) {
          return Response.json({ choices: [{ message: { content: "OK" } }] });
        }
        return Response.json({
          data: [
            { id: "chat-model" },
            { id: "reasoning-model", supported_parameters: ["reasoning_effort"] },
          ],
        });
      },
    });

    const response = await fetch(new URL(CHAT_MODELS_PATH, server.url), {
      method: "POST",
      headers: { Authorization: "Bearer tab-secret", "Content-Type": "application/json" },
      body: JSON.stringify({ baseUrl: "https://provider.example/v1" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [
        { id: "chat-model" },
        { id: "reasoning-model", supported_parameters: ["reasoning_effort"] },
      ],
    });
    expect(upstreamUrl).toBe("https://provider.example/v1/models");
    expect(upstreamInit?.method).toBe("GET");
    expect(upstreamInit?.headers).toEqual({ Accept: "application/json", Authorization: "Bearer tab-secret" });
    expect(String(upstreamInit?.body)).toBe("undefined");

    const testResponse = await fetch(new URL(CHAT_TEST_PATH, server.url), {
      method: "POST",
      headers: { Authorization: "Bearer tab-secret", "Content-Type": "application/json" },
      body: JSON.stringify({ baseUrl: "https://provider.example/v1", model: "reasoning-model", reasoningEffort: "high" }),
    });
    expect(testResponse.status).toBe(200);
    expect(upstreamUrl).toBe("https://provider.example/v1/chat/completions");
    expect(JSON.parse(String(upstreamInit?.body))).toEqual({
      model: "reasoning-model",
      messages: [{ role: "user", content: CHAT_TEST_MESSAGE }],
      stream: false,
      reasoning_effort: "high",
    });
    expect(upstreamCalls).toBe(2);
  });

  test("returns actionable proxy errors without exposing provider details", async () => {
    server = createAppServer({
      port: 0,
      development: false,
      sessionRoot: await sessionRoot(),
      chatFetcher: async () => { throw new Error("secret provider path"); },
    });

    const missingKey = await fetch(new URL(CHAT_MODELS_PATH, server.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseUrl: "https://provider.example/v1" }),
    });
    expect(missingKey.status).toBe(401);

    const invalidTarget = await fetch(new URL(CHAT_TEST_PATH, server.url), {
      method: "POST",
      headers: { Authorization: "Bearer secret", "Content-Type": "application/json" },
      body: JSON.stringify({ baseUrl: "file:///etc/passwd", model: "m" }),
    });
    expect(invalidTarget.status).toBe(400);
    expect(await invalidTarget.json()).toEqual({ error: { message: "Base URL must use HTTP or HTTPS." } });

    for (const [path, body] of [
      [CHAT_TEST_PATH, { baseUrl: "https://provider.example/v1", model: "m" }],
      [CHAT_MODELS_PATH, { baseUrl: "https://provider.example/v1" }],
    ] as const) {
      const upstreamFailure = await fetch(new URL(path, server.url), {
        method: "POST",
        headers: { Authorization: "Bearer secret", "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(upstreamFailure.status).toBe(502);
      expect(await upstreamFailure.json()).toEqual({
        error: { message: "Unable to reach the model provider. Check the Base URL and that the provider is running." },
      });
    }

    // The conversation route is gone: nothing in the reader sends a prompt.
    const removedRoute = await fetch(new URL("/api/chat/completions", server.url), {
      method: "POST",
      headers: { Authorization: "Bearer secret", "Content-Type": "application/json" },
      body: JSON.stringify({ baseUrl: "https://provider.example/v1", model: "m", messages: [] }),
    });
    expect(removedRoute.status).toBe(405);
  });

  test("does not expose files outside the public directory", async () => {
    server = createAppServer({ port: 0, development: false, sessionRoot: await sessionRoot() });
    const response = await fetch(new URL("/../package.json", server.url));
    expect(response.status).toBe(404);
  });

  test("contains static paths using the platform's own separators", () => {
    expect(resolveContainedPath("/srv/public", "/index.html", path.posix)).toBe("/srv/public/index.html");
    expect(resolveContainedPath("/srv/public", "/", path.posix)).toBeUndefined();
    expect(resolveContainedPath("/srv/public", "/%E0%A4%A", path.posix)).toBeUndefined();
    expect(resolveContainedPath("C:\\app\\public", "/index.html", path.win32)).toBe("C:\\app\\public\\index.html");
    expect(resolveContainedPath("C:\\app\\public", "/fonts/a.woff2", path.win32)).toBe("C:\\app\\public\\fonts\\a.woff2");
    for (const escape of ["/../package.json", "/..%5C..%5Csecret.txt", "/%2E%2E/%2E%2E/secret.txt"]) {
      const resolved = resolveContainedPath("C:\\app\\public", escape, path.win32);
      expect(resolved === undefined || resolved.startsWith("C:\\app\\public\\")).toBe(true);
    }
  });

  test("answers only requests addressed to a local or explicitly allowed host", async () => {
    server = createAppServer({ port: 0, development: false, sessionRoot: await sessionRoot() });
    const sessions = new URL("/api/sessions", server.url);

    // A rebound DNS name reaches the loopback socket but still names the attacker's host.
    const rebound = await fetch(sessions, { headers: { Host: `attacker.example:${server.port}` } });
    expect(rebound.status).toBe(403);
    expect(await rebound.text()).not.toContain("sessions");
    expect((await fetch(new URL("/", server.url), { headers: { Host: "attacker.example" } })).status).toBe(403);

    for (const host of [`127.0.0.1:${server.port}`, `localhost:${server.port}`, `LOCALHOST:${server.port}`, `[::1]:${server.port}`]) {
      expect((await fetch(sessions, { headers: { Host: host } })).status).toBe(200);
    }

    server.stop(true);
    server = createAppServer({
      port: 0,
      development: false,
      sessionRoot: await sessionRoot(),
      allowedHosts: ["reader.internal"],
    });
    const allowed = await fetch(new URL("/health", server.url), { headers: { Host: `reader.internal:${server.port}` } });
    expect(allowed.status).toBe(200);
    expect((await fetch(new URL("/health", server.url), { headers: { Host: "other.internal" } })).status).toBe(403);
  });

  test("serves PDF worker resources with browser-safe content types", async () => {
    server = createAppServer({ port: 0, development: false, sessionRoot: await sessionRoot() });

    const workerResponse = await fetch(new URL("/assets/pdf.worker.mjs", server.url));
    expect(workerResponse.status).toBe(200);
    expect(workerResponse.headers.get("content-type")).toContain("text/javascript");
    expect(await workerResponse.text()).toContain("core-js");

    const wasmResponse = await fetch(new URL("/assets/wasm/openjpeg.wasm", server.url));
    expect(wasmResponse.status).toBe(200);
    expect(wasmResponse.headers.get("content-type")).toBe("application/wasm");

    const viewerStylesResponse = await fetch(new URL("/assets/pdf_viewer.css", server.url));
    expect(viewerStylesResponse.status).toBe(200);
    expect(viewerStylesResponse.headers.get("content-type")).toContain("text/css");

    const annotationIconResponse = await fetch(new URL("/assets/images/annotation-note.svg", server.url));
    expect(annotationIconResponse.status).toBe(200);
    expect(annotationIconResponse.headers.get("content-type")).toBe("image/svg+xml");
  });

  test("persists uploaded PDFs as sessions and serves their history", async () => {
    server = createAppServer({ port: 0, development: false, sessionRoot: await sessionRoot() });
    const pdf = new TextEncoder().encode("%PDF-1.7\nserver session fixture\n%%EOF\n");

    const createResponse = await fetch(new URL("/api/sessions", server.url), {
      method: "POST",
      headers: {
        "Content-Type": "application/pdf",
        "X-Ultra-Learner-Filename": encodeURIComponent("课程笔记.pdf"),
      },
      body: pdf,
    });
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()).session as {
      id: string;
      filename: string;
      fileSize: number;
      createdAt: string;
    };
    expect(created.filename).toBe("课程笔记.pdf");
    expect(created.fileSize).toBe(pdf.byteLength);

    const repeatedResponse = await fetch(new URL("/api/sessions", server.url), {
      method: "POST",
      headers: { "X-Ultra-Learner-Filename": encodeURIComponent("课程笔记.pdf") },
      body: pdf,
    });
    expect(repeatedResponse.status).toBe(200);
    expect(await repeatedResponse.json()).toEqual({ session: created });

    const listResponse = await fetch(new URL("/api/sessions", server.url));
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toEqual({ sessions: [created] });

    const documentResponse = await fetch(new URL(`/api/sessions/${created.id}/document`, server.url));
    expect(documentResponse.status).toBe(200);
    expect(documentResponse.headers.get("content-type")).toBe("application/pdf");
    expect(new Uint8Array(await documentResponse.arrayBuffer())).toEqual(pdf);

    const deleteResponse = await fetch(new URL(`/api/sessions/${created.id}`, server.url), { method: "DELETE" });
    expect(deleteResponse.status).toBe(204);

    const emptyListResponse = await fetch(new URL("/api/sessions", server.url));
    expect(await emptyListResponse.json()).toEqual({ sessions: [] });
    expect((await fetch(new URL(`/api/sessions/${created.id}/document`, server.url))).status).toBe(404);
    expect((await fetch(new URL(`/api/sessions/${created.id}`, server.url), { method: "DELETE" })).status).toBe(404);
  });

  test("rejects malformed session uploads and inaccessible documents", async () => {
    server = createAppServer({ port: 0, development: false, sessionRoot: await sessionRoot() });

    const emptyResponse = await fetch(new URL("/api/sessions", server.url), {
      method: "POST",
      headers: { "X-Ultra-Learner-Filename": encodeURIComponent("notes.pdf") },
    });
    expect(emptyResponse.status).toBe(400);
    expect(await emptyResponse.json()).toEqual({ error: { message: "That PDF is empty." } });

    const unnamedResponse = await fetch(new URL("/api/sessions", server.url), { method: "POST", body: "%PDF-1.7\n" });
    expect(unnamedResponse.status).toBe(400);
    expect(await unnamedResponse.json()).toEqual({ error: { message: "The PDF filename is invalid." } });

    const invalidResponse = await fetch(new URL("/api/sessions", server.url), {
      method: "POST",
      headers: { "X-Ultra-Learner-Filename": encodeURIComponent("notes.pdf") },
      body: "not a PDF",
    });
    expect(invalidResponse.status).toBe(400);
    expect(await invalidResponse.json()).toEqual({
      error: { message: "The uploaded file does not contain a PDF header." },
    });

    const missingResponse = await fetch(new URL("/api/sessions/missing/document", server.url));
    expect(missingResponse.status).toBe(404);

    const traversalResponse = await fetch(new URL("/api/sessions/%2E%2E%2Fsecret/document", server.url));
    expect(traversalResponse.status).toBe(404);

    const traversalDeleteResponse = await fetch(new URL("/api/sessions/%2E%2E%2Fsecret", server.url), {
      method: "DELETE",
    });
    expect(traversalDeleteResponse.status).toBe(404);
  });
});
