import { statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

import {
  CHAT_PROXY_PATH,
  CHAT_MODELS_PATH,
  CHAT_TEST_MESSAGE,
  CHAT_TEST_PATH,
  chatCompletionsUrl,
  chatModelsUrl,
  MAXIMUM_CHAT_REQUEST_SIZE,
  parseChatProxyPayload,
  parseChatModelsPayload,
  parseChatTestPayload,
  type ChatFetcher,
} from "./lib/chat.ts";
import { MAXIMUM_PDF_FILE_SIZE } from "./lib/files.ts";
import { SessionNotFoundError, SessionStore, type SessionStoreOptions } from "./session-store.ts";

export interface AppServerOptions {
  port?: number;
  hostname?: string;
  development?: boolean;
  root?: string;
  sessionStore?: SessionStore;
  sessionRoot?: SessionStoreOptions["root"];
  chatFetcher?: ChatFetcher;
}

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".icc": "application/vnd.iccprofile",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".pdf": "application/pdf",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

class PayloadTooLargeError extends Error {}

const MAXIMUM_CHAT_RESPONSE_SIZE = 2 * 1024 * 1024;
const MAXIMUM_CHAT_MODELS_RESPONSE_SIZE = 8 * 1024 * 1024;
const CHAT_PROVIDER_TIMEOUT_MS = 60_000;

async function readBodyBytes(body: ReadableStream<Uint8Array> | null, maximumSize: number): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumSize) {
        await reader.cancel();
        throw new PayloadTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return data;
}

async function readRequestBytes(request: Request, maximumSize: number): Promise<Uint8Array> {
  return readBodyBytes(request.body, maximumSize);
}

async function readResponseText(response: Response, maximumSize: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumSize) {
        await reader.cancel();
        throw new PayloadTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function hasOversizedContentLength(headers: Headers, maximumSize: number): boolean {
  const value = headers.get("content-length");
  if (value === null) return false;
  const size = Number(value);
  return Number.isFinite(size) && size > maximumSize;
}

function jsonError(message: string, status: number): Response {
  return Response.json({ error: { message } }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function bearerToken(request: Request): string | undefined {
  const value = request.headers.get("authorization")?.trim();
  const match = value?.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ? `Bearer ${match[1]}` : undefined;
}

async function proxyChatCompletion(request: Request, fetcher: ChatFetcher): Promise<Response> {
  const authorization = bearerToken(request);
  if (!authorization) return jsonError("An API key is required.", 401);

  const contentLengthHeader = request.headers.get("content-length");
  const contentLength = contentLengthHeader === null ? null : Number(contentLengthHeader);
  if (contentLength !== null && Number.isFinite(contentLength) && contentLength > MAXIMUM_CHAT_REQUEST_SIZE) {
    return jsonError("The chat request is too large.", 413);
  }

  let payload: ReturnType<typeof parseChatProxyPayload>;
  try {
    const bytes = await readRequestBytes(request, MAXIMUM_CHAT_REQUEST_SIZE);
    payload = parseChatProxyPayload(JSON.parse(new TextDecoder().decode(bytes)));
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return jsonError("The chat request is too large.", 413);
    if (error instanceof Error) return jsonError(error.message, 400);
    return jsonError("Unable to read the chat request.", 400);
  }

  const upstreamUrl = chatCompletionsUrl(payload.baseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHAT_PROVIDER_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetcher(upstreamUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: authorization,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: payload.model,
        messages: payload.messages,
        stream: false,
        ...(payload.reasoningEffort ? { reasoning_effort: payload.reasoningEffort } : {}),
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      return jsonError("The model provider timed out. Check the provider and try again.", 504);
    }
    return jsonError("Unable to reach the model provider. Check the Base URL and that the provider is running.", 502);
  }
  try {
    const body = await readResponseText(response, MAXIMUM_CHAT_RESPONSE_SIZE);
    return new Response(body, {
      status: response.status,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": response.headers.get("content-type") ?? "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (controller.signal.aborted) return jsonError("The model provider timed out. Check the provider and try again.", 504);
    if (error instanceof PayloadTooLargeError) return jsonError("The model response is too large.", 502);
    return jsonError("Unable to read the model provider response.", 502);
  } finally {
    clearTimeout(timeout);
  }
}

async function forwardChatRequest(
  request: Request,
  fetcher: ChatFetcher,
  payload: {
    baseUrl: string;
    model: string;
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    reasoningEffort?: string;
  },
  missingPayloadMessage: string,
): Promise<Response> {
  const authorization = bearerToken(request);
  if (!authorization) return jsonError("An API key is required.", 401);

  const upstreamUrl = chatCompletionsUrl(payload.baseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHAT_PROVIDER_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetcher(upstreamUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: authorization,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: payload.model,
        messages: payload.messages,
        stream: false,
        ...(payload.reasoningEffort ? { reasoning_effort: payload.reasoningEffort } : {}),
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      return jsonError("The model provider timed out. Check the provider and try again.", 504);
    }
    return jsonError("Unable to reach the model provider. Check the Base URL and that the provider is running.", 502);
  }
  try {
    const body = await readResponseText(response, MAXIMUM_CHAT_RESPONSE_SIZE);
    return new Response(body, {
      status: response.status,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": response.headers.get("content-type") ?? "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (controller.signal.aborted) return jsonError("The model provider timed out. Check the provider and try again.", 504);
    if (error instanceof PayloadTooLargeError) return jsonError("The model response is too large.", 502);
    return jsonError(missingPayloadMessage, 502);
  } finally {
    clearTimeout(timeout);
  }
}

async function testChatProvider(request: Request, fetcher: ChatFetcher): Promise<Response> {
  const authorization = bearerToken(request);
  if (!authorization) return jsonError("An API key is required.", 401);

  const contentLengthHeader = request.headers.get("content-length");
  const contentLength = contentLengthHeader === null ? null : Number(contentLengthHeader);
  if (contentLength !== null && Number.isFinite(contentLength) && contentLength > MAXIMUM_CHAT_REQUEST_SIZE) {
    return jsonError("The chat test request is too large.", 413);
  }

  let payload: ReturnType<typeof parseChatTestPayload>;
  try {
    const bytes = await readRequestBytes(request, MAXIMUM_CHAT_REQUEST_SIZE);
    payload = parseChatTestPayload(JSON.parse(new TextDecoder().decode(bytes)));
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return jsonError("The chat test request is too large.", 413);
    if (error instanceof Error) return jsonError(error.message, 400);
    return jsonError("Unable to read the chat test request.", 400);
  }

  return forwardChatRequest(request, fetcher, {
    baseUrl: payload.baseUrl,
    model: payload.model,
    reasoningEffort: payload.reasoningEffort,
    messages: [{ role: "user", content: CHAT_TEST_MESSAGE }],
  }, "Unable to read the model provider response.");
}

async function listChatModels(request: Request, fetcher: ChatFetcher): Promise<Response> {
  const authorization = bearerToken(request);
  if (!authorization) return jsonError("An API key is required.", 401);

  const contentLengthHeader = request.headers.get("content-length");
  const contentLength = contentLengthHeader === null ? null : Number(contentLengthHeader);
  if (contentLength !== null && Number.isFinite(contentLength) && contentLength > MAXIMUM_CHAT_REQUEST_SIZE) {
    return jsonError("The model list request is too large.", 413);
  }

  let payload: ReturnType<typeof parseChatModelsPayload>;
  try {
    const bytes = await readRequestBytes(request, MAXIMUM_CHAT_REQUEST_SIZE);
    payload = parseChatModelsPayload(JSON.parse(new TextDecoder().decode(bytes)));
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return jsonError("The model list request is too large.", 413);
    if (error instanceof Error) return jsonError(error.message, 400);
    return jsonError("Unable to read the model list request.", 400);
  }

  const upstreamUrl = chatModelsUrl(payload.baseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHAT_PROVIDER_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetcher(upstreamUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: authorization,
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      return jsonError("The model provider timed out. Check the provider and try again.", 504);
    }
    return jsonError("Unable to reach the model provider. Check the Base URL and that the provider is running.", 502);
  }

  try {
    if (hasOversizedContentLength(response.headers, MAXIMUM_CHAT_MODELS_RESPONSE_SIZE)) {
      await response.body?.cancel();
      return jsonError("The model list response is too large.", 502);
    }
    const body = await readResponseText(response, MAXIMUM_CHAT_MODELS_RESPONSE_SIZE);
    return new Response(body, {
      status: response.status,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": response.headers.get("content-type") ?? "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (controller.signal.aborted) return jsonError("The model provider timed out. Check the provider and try again.", 504);
    if (error instanceof PayloadTooLargeError) return jsonError("The model list response is too large.", 502);
    return jsonError("Unable to read the model provider response.", 502);
  } finally {
    clearTimeout(timeout);
  }
}

function safeAssetPath(root: string, pathname: string): string | undefined {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  const normalizedPath = normalize(decodedPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const candidate = resolve(root, `.${normalizedPath}`);
  return candidate.startsWith(`${resolve(root)}/`) ? candidate : undefined;
}

function responseForFile(path: string): Response {
  return new Response(Bun.file(path), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": contentTypes[extname(path)] ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function createAppServer(options: AppServerOptions = {}): Bun.Server<undefined> {
  const root = options.root ?? resolve(import.meta.dir, "..");
  const publicRoot = join(root, "public");
  const sessionStore = options.sessionStore ?? new SessionStore({ root: options.sessionRoot });
  const chatFetcher = options.chatFetcher ?? fetch;

  return Bun.serve({
    port: options.port ?? Number(Bun.env.PORT ?? 8881),
    hostname: options.hostname ?? "127.0.0.1",
    development: options.development ?? Bun.env.NODE_ENV !== "production",
    async fetch(request) {
      const url = new URL(request.url);

      if (url.pathname === "/health") {
        if (request.method !== "GET" && request.method !== "HEAD") {
          return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
        }
        return Response.json({ status: "ok" });
      }

      if (url.pathname === CHAT_PROXY_PATH) {
        if (request.method !== "POST") {
          return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
        }
        return proxyChatCompletion(request, chatFetcher);
      }

      if (url.pathname === CHAT_TEST_PATH) {
        if (request.method !== "POST") {
          return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
        }
        return testChatProvider(request, chatFetcher);
      }

      if (url.pathname === CHAT_MODELS_PATH) {
        if (request.method !== "POST") {
          return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
        }
        return listChatModels(request, chatFetcher);
      }

      if (url.pathname === "/api/sessions") {
        if (request.method === "GET" || request.method === "HEAD") {
          try {
            return Response.json({ sessions: await sessionStore.listSessions() }, {
              headers: { "Cache-Control": "no-store" },
            });
          } catch (error) {
            console.error(error);
            return Response.json({ error: "Unable to load the PDF session history." }, { status: 500 });
          }
        }
        if (request.method === "POST") {
          const contentLengthHeader = request.headers.get("content-length");
          const contentLength = contentLengthHeader === null ? null : Number(contentLengthHeader);
          if (contentLength !== null && Number.isFinite(contentLength) && contentLength > MAXIMUM_PDF_FILE_SIZE) {
            return Response.json({ error: "That PDF is larger than 100 MB." }, { status: 413 });
          }

          const encodedFilename = request.headers.get("x-ultra-learner-filename");
          let filename: string;
          try {
            filename = encodedFilename ? decodeURIComponent(encodedFilename) : "";
          } catch {
            return Response.json({ error: "The PDF filename is invalid." }, { status: 400 });
          }

          try {
            const data = await readRequestBytes(request, MAXIMUM_PDF_FILE_SIZE);
            const session = await sessionStore.createSession(filename, data);
            return Response.json({ session }, { status: 201, headers: { "Cache-Control": "no-store" } });
          } catch (error) {
            if (error instanceof PayloadTooLargeError) {
              return Response.json({ error: "That PDF is larger than 100 MB." }, { status: 413 });
            }
            if (error instanceof TypeError) return Response.json({ error: error.message }, { status: 400 });
            console.error(error);
            return Response.json({ error: "Unable to save the PDF session." }, { status: 500 });
          }
        }
        return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD, POST" } });
      }

      const sessionDocumentMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/document$/);
      if (sessionDocumentMatch) {
        if (request.method !== "GET" && request.method !== "HEAD") {
          return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
        }
        try {
          const document = await sessionStore.getSessionDocument(decodeURIComponent(sessionDocumentMatch[1] ?? ""));
          return new Response(Bun.file(document.path), {
            headers: {
              "Cache-Control": "no-store",
              "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(document.summary.filename)}`,
              "Content-Type": "application/pdf",
              "X-Content-Type-Options": "nosniff",
              "X-Ultra-Learner-Filename": encodeURIComponent(document.summary.filename),
            },
          });
        } catch (error) {
          if (error instanceof SessionNotFoundError || error instanceof URIError) {
            return new Response("Not found", { status: 404 });
          }
          throw error;
        }
      }

      const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
      if (sessionMatch) {
        if (request.method !== "DELETE") {
          return new Response("Method not allowed", { status: 405, headers: { Allow: "DELETE" } });
        }
        try {
          await sessionStore.deleteSession(decodeURIComponent(sessionMatch[1] ?? ""));
          return new Response(null, { status: 204 });
        } catch (error) {
          if (error instanceof SessionNotFoundError || error instanceof URIError) {
            return new Response("Not found", { status: 404 });
          }
          console.error(error);
          return Response.json({ error: "Unable to delete the PDF session." }, { status: 500 });
        }
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
      }

      if (url.pathname === "/assets/app.js") {
        const build = await Bun.build({
          entrypoints: [join(root, "src", "web", "app.ts")],
          target: "browser",
          format: "esm",
          minify: Bun.env.NODE_ENV === "production",
          sourcemap: "none",
        });

        if (!build.success || !build.outputs[0]) {
          const message = build.logs.map((log) => log.message).join("\n") || "Frontend build failed";
          console.error(message);
          return new Response("Unable to build the reader", { status: 500 });
        }

        return new Response(await build.outputs[0].arrayBuffer(), {
          headers: {
            "Cache-Control": "no-store",
            "Content-Type": "text/javascript; charset=utf-8",
          },
        });
      }

      if (url.pathname === "/assets/pdf.worker.mjs") {
        return responseForFile(join(root, "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.min.mjs"));
      }

      if (url.pathname === "/assets/pdf_viewer.css") {
        return responseForFile(join(root, "node_modules", "pdfjs-dist", "web", "pdf_viewer.css"));
      }

      const pdfAssetDirectories: Record<string, string> = {
        "/assets/cmaps/": "cmaps",
        "/assets/iccs/": "iccs",
        "/assets/images/": "web/images",
        "/assets/standard_fonts/": "standard_fonts",
        "/assets/wasm/": "wasm",
      };
      for (const [urlPrefix, directory] of Object.entries(pdfAssetDirectories)) {
        if (!url.pathname.startsWith(urlPrefix)) continue;
        const filename = url.pathname.slice(urlPrefix.length);
        const pdfAssetPath = safeAssetPath(join(root, "node_modules", "pdfjs-dist", directory), `/${filename}`);
        if (pdfAssetPath && isFile(pdfAssetPath)) return responseForFile(pdfAssetPath);
      }

      const assetPath = safeAssetPath(publicRoot, url.pathname === "/" ? "/index.html" : url.pathname);
      if (assetPath && isFile(assetPath)) return responseForFile(assetPath);

      return new Response("Not found", { status: 404 });
    },
  });
}
