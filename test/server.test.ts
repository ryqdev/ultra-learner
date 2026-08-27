import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAppServer } from "../src/server.ts";
import { CHAT_PROXY_PATH, CHAT_TEST_PATH, CHAT_TEST_MESSAGE } from "../src/lib/chat.ts";

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

describe("web server", () => {
  test("serves the application and health endpoint", async () => {
    server = createAppServer({ port: 0, development: false, sessionRoot: await sessionRoot() });

    const pageResponse = await fetch(server.url);
    const page = await pageResponse.text();
    expect(pageResponse.status).toBe(200);
    expect(pageResponse.headers.get("content-type")).toContain("text/html");
    expect(page).toContain("Ultra Learner");
    expect(page).not.toContain("Stays on this device");
    expect(page).toContain("Choose PDF");
    expect(page).toContain('id="chat-panel"');
    expect(page).toContain('id="chat-resize-handle"');
    expect(page).toContain('role="separator"');
    expect(page).toContain('id="chat-config-form"');
    expect(page).toContain('id="chat-provider-preset"');
    expect(page).toContain('id="chat-api-key-toggle"');
    expect(page).toContain('id="chat-config-summary"');
    expect(page).toContain("Save &amp; use model");
    expect(page).toContain("Ollama · local");
    expect(page).toContain('id="new-session-button"');
    expect(page).toContain('id="text-layer"');
    expect(page).toContain('class="textLayer" id="text-layer" tabindex="0"');
    expect(page).toContain('id="app-sidebar"');
    expect(page).toContain('id="app-sidebar-toggle"');
    expect(page).toContain('id="sidebar-new-chat"');
    expect(page).not.toContain('id="sidebar-open-pdf"');
    expect(page).not.toContain(">Open PDF<");
    expect(page).toContain('id="history-list"');
    expect(page).toContain("~/.ultra-learner");
    expect(page).toContain('id="annotation-layer"');
    expect(page).toContain('/assets/pdf_viewer.css');

    const healthResponse = await fetch(new URL("/health", server.url));
    expect(await healthResponse.json()).toEqual({ status: "ok" });
  });

  test("builds the browser entry and rejects unsupported methods", async () => {
    server = createAppServer({ port: 0, development: false, sessionRoot: await sessionRoot() });

    const appResponse = await fetch(new URL("/assets/app.js", server.url));
    expect(appResponse.status).toBe(200);
    expect(appResponse.headers.get("content-type")).toContain("text/javascript");
    expect((await appResponse.text()).length).toBeGreaterThan(100_000);

    const postResponse = await fetch(server.url, { method: "POST" });
    expect(postResponse.status).toBe(405);

    const chatGetResponse = await fetch(new URL(CHAT_PROXY_PATH, server.url));
    expect(chatGetResponse.status).toBe(405);
    expect(chatGetResponse.headers.get("allow")).toBe("POST");

    const chatTestGetResponse = await fetch(new URL(CHAT_TEST_PATH, server.url));
    expect(chatTestGetResponse.status).toBe(405);
    expect(chatTestGetResponse.headers.get("allow")).toBe("POST");

    const pageResponse = await fetch(server.url);
    expect(await pageResponse.text()).toContain('id="new-session-button"');
  });

  test("forwards chat requests through the same-origin proxy", async () => {
    let upstreamUrl = "";
    let upstreamInit: RequestInit | undefined;
    server = createAppServer({
      port: 0,
      development: false,
      sessionRoot: await sessionRoot(),
      chatFetcher: async (input, init) => {
        upstreamUrl = String(input);
        upstreamInit = init;
        return Response.json({ choices: [{ message: { content: "hello from provider" } }] });
      },
    });

    const response = await fetch(new URL(CHAT_PROXY_PATH, server.url), {
      method: "POST",
      headers: {
        Authorization: "Bearer tab-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        baseUrl: "https://provider.example/v1",
        model: "study-model",
        messages: [{ role: "user", content: "hello" }],
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ choices: [{ message: { content: "hello from provider" } }] });
    expect(upstreamUrl).toBe("https://provider.example/v1/chat/completions");
    expect(upstreamInit?.headers).toEqual({
      Accept: "application/json",
      Authorization: "Bearer tab-secret",
      "Content-Type": "application/json",
    });
    expect(String(upstreamInit?.body)).not.toContain("tab-secret");
    expect(JSON.parse(String(upstreamInit?.body))).toEqual({
      model: "study-model",
      messages: [{ role: "user", content: "hello" }],
      stream: false,
    });
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

  test("returns actionable proxy errors without exposing provider details", async () => {
    server = createAppServer({
      port: 0,
      development: false,
      sessionRoot: await sessionRoot(),
      chatFetcher: async () => { throw new Error("secret provider path"); },
    });

    const missingKey = await fetch(new URL(CHAT_PROXY_PATH, server.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseUrl: "https://provider.example/v1", model: "m", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(missingKey.status).toBe(401);

    const upstreamFailure = await fetch(new URL(CHAT_PROXY_PATH, server.url), {
      method: "POST",
      headers: { Authorization: "Bearer secret", "Content-Type": "application/json" },
      body: JSON.stringify({ baseUrl: "https://provider.example/v1", model: "m", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(upstreamFailure.status).toBe(502);
    expect(await upstreamFailure.json()).toEqual({
      error: { message: "Unable to reach the model provider. Check the Base URL and that the provider is running." },
    });
  });

  test("does not expose files outside the public directory", async () => {
    server = createAppServer({ port: 0, development: false, sessionRoot: await sessionRoot() });
    const response = await fetch(new URL("/../package.json", server.url));
    expect(response.status).toBe(404);
  });

  test("serves PDF worker resources with browser-safe content types", async () => {
    server = createAppServer({ port: 0, development: false, sessionRoot: await sessionRoot() });

    const workerResponse = await fetch(new URL("/assets/pdf.worker.mjs", server.url));
    expect(workerResponse.status).toBe(200);
    expect(workerResponse.headers.get("content-type")).toContain("text/javascript");

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

    const listResponse = await fetch(new URL("/api/sessions", server.url));
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toEqual({ sessions: [created] });

    const documentResponse = await fetch(new URL(`/api/sessions/${created.id}/document`, server.url));
    expect(documentResponse.status).toBe(200);
    expect(documentResponse.headers.get("content-type")).toBe("application/pdf");
    expect(new Uint8Array(await documentResponse.arrayBuffer())).toEqual(pdf);
  });

  test("rejects malformed session uploads and inaccessible documents", async () => {
    server = createAppServer({ port: 0, development: false, sessionRoot: await sessionRoot() });

    const invalidResponse = await fetch(new URL("/api/sessions", server.url), {
      method: "POST",
      headers: { "X-Ultra-Learner-Filename": encodeURIComponent("notes.pdf") },
      body: "not a PDF",
    });
    expect(invalidResponse.status).toBe(400);
    expect(await invalidResponse.json()).toEqual({ error: "The uploaded file does not contain a PDF header." });

    const missingResponse = await fetch(new URL("/api/sessions/missing/document", server.url));
    expect(missingResponse.status).toBe(404);

    const traversalResponse = await fetch(new URL("/api/sessions/%2E%2E%2Fsecret/document", server.url));
    expect(traversalResponse.status).toBe(404);
  });
});
