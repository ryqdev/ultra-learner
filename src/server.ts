import { statSync } from "node:fs";
import path, { dirname, extname, join } from "node:path";

import {
  CHAT_MODELS_PATH,
  CHAT_TEST_MESSAGE,
  CHAT_TEST_PATH,
  chatCompletionsUrl,
  chatModelsUrl,
  MAXIMUM_CHAT_REQUEST_SIZE,
  parseChatModelsPayload,
  parseChatTestPayload,
  type ChatFetcher,
} from "./lib/chat.ts";
import { MAXIMUM_PDF_FILE_SIZE } from "./lib/files.ts";
import {
  SessionNotFoundError,
  SessionStore,
  SessionTooLargeError,
  type SessionStoreOptions,
} from "./session-store.ts";

export interface AppServerOptions {
  port?: number;
  hostname?: string;
  /** Extra names clients may address the server by, for a deliberate non-loopback deployment. */
  allowedHosts?: readonly string[];
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

function methodNotAllowed(allow: string): Response {
  return new Response("Method not allowed", { status: 405, headers: { Allow: allow } });
}

function bearerToken(request: Request): string | undefined {
  const value = request.headers.get("authorization")?.trim();
  const match = value?.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ? `Bearer ${match[1]}` : undefined;
}

/** Read and validate a bounded JSON body, or produce the error response that explains why not. */
async function readJsonPayload<T>(
  request: Request,
  description: string,
  parse: (value: unknown) => T,
): Promise<T | Response> {
  if (hasOversizedContentLength(request.headers, MAXIMUM_CHAT_REQUEST_SIZE)) {
    return jsonError(`The ${description} is too large.`, 413);
  }
  try {
    const bytes = await readBodyBytes(request.body, MAXIMUM_CHAT_REQUEST_SIZE);
    return parse(JSON.parse(new TextDecoder().decode(bytes)));
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return jsonError(`The ${description} is too large.`, 413);
    if (error instanceof Error) return jsonError(error.message, 400);
    return jsonError(`Unable to read the ${description}.`, 400);
  }
}

interface ProviderRequest {
  url: string;
  authorization: string;
  /** A JSON body makes this a POST; without one the provider receives a GET. */
  body?: unknown;
  maximumResponseSize: number;
  tooLargeMessage: string;
}

/** Relay one bounded, time-limited request to the model provider and pass its answer through. */
async function forwardToProvider(fetcher: ChatFetcher, request: ProviderRequest): Promise<Response> {
  const timedOut = (): Response =>
    jsonError("The model provider timed out. Check the provider and try again.", 504);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHAT_PROVIDER_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetcher(request.url, request.body === undefined
        ? {
          method: "GET",
          headers: { Accept: "application/json", Authorization: request.authorization },
          signal: controller.signal,
        }
        : {
          method: "POST",
          headers: {
            Accept: "application/json",
            Authorization: request.authorization,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(request.body),
          signal: controller.signal,
        });
    } catch {
      if (controller.signal.aborted) return timedOut();
      return jsonError("Unable to reach the model provider. Check the Base URL and that the provider is running.", 502);
    }

    try {
      if (hasOversizedContentLength(response.headers, request.maximumResponseSize)) {
        await response.body?.cancel();
        return jsonError(request.tooLargeMessage, 502);
      }
      const body = new TextDecoder().decode(await readBodyBytes(response.body, request.maximumResponseSize));
      return new Response(body, {
        status: response.status,
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": response.headers.get("content-type") ?? "application/json; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      if (controller.signal.aborted) return timedOut();
      if (error instanceof PayloadTooLargeError) return jsonError(request.tooLargeMessage, 502);
      return jsonError("Unable to read the model provider response.", 502);
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function testChatProvider(request: Request, fetcher: ChatFetcher): Promise<Response> {
  const authorization = bearerToken(request);
  if (!authorization) return jsonError("An API key is required.", 401);
  const payload = await readJsonPayload(request, "chat test request", parseChatTestPayload);
  if (payload instanceof Response) return payload;
  return forwardToProvider(fetcher, {
    url: chatCompletionsUrl(payload.baseUrl),
    authorization,
    body: {
      model: payload.model,
      messages: [{ role: "user", content: CHAT_TEST_MESSAGE }],
      stream: false,
      ...(payload.reasoningEffort ? { reasoning_effort: payload.reasoningEffort } : {}),
    },
    maximumResponseSize: MAXIMUM_CHAT_RESPONSE_SIZE,
    tooLargeMessage: "The model response is too large.",
  });
}

async function listChatModels(request: Request, fetcher: ChatFetcher): Promise<Response> {
  const authorization = bearerToken(request);
  if (!authorization) return jsonError("An API key is required.", 401);
  const payload = await readJsonPayload(request, "model list request", parseChatModelsPayload);
  if (payload instanceof Response) return payload;
  return forwardToProvider(fetcher, {
    url: chatModelsUrl(payload.baseUrl),
    authorization,
    maximumResponseSize: MAXIMUM_CHAT_MODELS_RESPONSE_SIZE,
    tooLargeMessage: "The model list response is too large.",
  });
}

type PathApi = Pick<typeof path, "isAbsolute" | "normalize" | "relative" | "resolve" | "sep">;

/** Map a request path to a file inside `root`, or `undefined` when it would escape it. */
export function resolveContainedPath(root: string, pathname: string, pathApi: PathApi = path): string | undefined {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  const normalizedPath = pathApi.normalize(decodedPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const base = pathApi.resolve(root);
  const candidate = pathApi.resolve(base, `.${normalizedPath}`);
  // Compare through the platform's own relative path: a hard-coded "/" never matches on Windows.
  const offset = pathApi.relative(base, candidate);
  const escapes = offset === ".." || offset.startsWith(`..${pathApi.sep}`) || pathApi.isAbsolute(offset);
  return offset && !escapes ? candidate : undefined;
}

const LOOPBACK_HOSTNAMES = ["127.0.0.1", "localhost", "[::1]"];
const WILDCARD_HOSTNAMES = new Set(["0.0.0.0", "[::]"]);

function urlHostname(host: string): string | null {
  try {
    return new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Collect the names this server answers to. A page on another domain can rebind
 * its DNS name to 127.0.0.1 and become same-origin with the session API, so the
 * request Host must be one the user could have typed for this server.
 */
function allowedHostnames(options: AppServerOptions): Set<string> {
  const allowed = new Set<string>();
  for (const name of [...LOOPBACK_HOSTNAMES, options.hostname ?? "", ...(options.allowedHosts ?? [])]) {
    // A bare IPv6 address needs brackets before it can be read as a URL host.
    const hostname = urlHostname(name.includes(":") && !name.startsWith("[") ? `[${name}]` : name);
    if (hostname && !WILDCARD_HOSTNAMES.has(hostname)) allowed.add(hostname);
  }
  return allowed;
}

function hasAllowedHost(request: Request, allowed: ReadonlySet<string>): boolean {
  const host = request.headers.get("host");
  const hostname = host ? urlHostname(host) : null;
  return hostname !== null && allowed.has(hostname);
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
  const root = options.root ?? path.resolve(import.meta.dir, "..");
  const publicRoot = join(root, "public");
  // Dependencies may be hoisted outside this package after installation.
  const pdfRoot = dirname(Bun.resolveSync("pdfjs-dist/package.json", import.meta.dir));
  const sessionStore = options.sessionStore ?? new SessionStore({ root: options.sessionRoot });
  const chatFetcher = options.chatFetcher ?? fetch;
  const allowedHosts = allowedHostnames(options);
  // An installed reader has no NODE_ENV, so development behavior has to be asked for.
  const development = options.development ?? Bun.env.NODE_ENV === "development";
  let cachedBundle: Promise<ArrayBuffer | null> | null = null;

  async function buildBrowserBundle(): Promise<ArrayBuffer | null> {
    try {
      const build = await Bun.build({
        entrypoints: [join(root, "src", "web", "app.ts")],
        target: "browser",
        format: "esm",
        minify: !development,
        sourcemap: "none",
        // Bun rejects on a failed build by default, which would skip the handled reply.
        throw: false,
      });
      const output = build.outputs[0];
      if (build.success && output) return await output.arrayBuffer();
      console.error(build.logs.map((log) => log.message).join("\n") || "Frontend build failed");
    } catch (error) {
      console.error(error);
    }
    return null;
  }

  /** Build once for a running reader; rebuild per request only while the browser code is being edited. */
  function browserBundle(): Promise<ArrayBuffer | null> {
    if (development) return buildBrowserBundle();
    cachedBundle ??= buildBrowserBundle().then((bundle) => {
      // A failed build is not remembered, so the next request tries again.
      if (!bundle) cachedBundle = null;
      return bundle;
    });
    return cachedBundle;
  }

  return Bun.serve({
    port: options.port ?? Number(Bun.env.PORT ?? 8881),
    hostname: options.hostname ?? "127.0.0.1",
    development,
    async fetch(request) {
      if (!hasAllowedHost(request, allowedHosts)) {
        return new Response("This server only answers requests addressed to its local address.", { status: 403 });
      }
      const url = new URL(request.url);

      if (url.pathname === "/health") {
        if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed("GET, HEAD");
        return Response.json({ status: "ok" });
      }

      if (url.pathname === CHAT_TEST_PATH) {
        if (request.method !== "POST") return methodNotAllowed("POST");
        return testChatProvider(request, chatFetcher);
      }

      if (url.pathname === CHAT_MODELS_PATH) {
        if (request.method !== "POST") return methodNotAllowed("POST");
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
            return jsonError("Unable to load the PDF session history.", 500);
          }
        }
        if (request.method === "POST") {
          if (hasOversizedContentLength(request.headers, MAXIMUM_PDF_FILE_SIZE)) {
            return jsonError("That PDF is larger than 100 MB.", 413);
          }

          const encodedFilename = request.headers.get("x-ultra-learner-filename");
          let filename: string;
          try {
            filename = encodedFilename ? decodeURIComponent(encodedFilename) : "";
          } catch {
            return jsonError("The PDF filename is invalid.", 400);
          }

          try {
            // The store writes the body to disk as it arrives, so a large PDF is never held in memory here.
            const { session, reused } = await sessionStore.createSession(filename, request.body ?? new Uint8Array());
            // An identical stored document answers the upload; nothing new was created.
            return Response.json({ session }, { status: reused ? 200 : 201, headers: { "Cache-Control": "no-store" } });
          } catch (error) {
            if (error instanceof SessionTooLargeError) return jsonError(error.message, 413);
            if (error instanceof TypeError) return jsonError(error.message, 400);
            console.error(error);
            return jsonError("Unable to save the PDF session.", 500);
          }
        }
        return methodNotAllowed("GET, HEAD, POST");
      }

      const sessionDocumentMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/document$/);
      if (sessionDocumentMatch) {
        if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed("GET, HEAD");
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
        if (request.method !== "DELETE") return methodNotAllowed("DELETE");
        try {
          await sessionStore.deleteSession(decodeURIComponent(sessionMatch[1] ?? ""));
          return new Response(null, { status: 204 });
        } catch (error) {
          if (error instanceof SessionNotFoundError || error instanceof URIError) {
            return new Response("Not found", { status: 404 });
          }
          console.error(error);
          return jsonError("Unable to delete the PDF session.", 500);
        }
      }

      if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed("GET, HEAD");

      if (url.pathname === "/assets/app.js") {
        const bundle = await browserBundle();
        if (!bundle) return new Response("Unable to build the reader", { status: 500 });
        return new Response(bundle, {
          headers: {
            "Cache-Control": "no-store",
            "Content-Type": "text/javascript; charset=utf-8",
          },
        });
      }

      if (url.pathname === "/assets/pdf.worker.mjs") {
        return responseForFile(join(pdfRoot, "legacy", "build", "pdf.worker.min.mjs"));
      }

      if (url.pathname === "/assets/pdf_viewer.css") {
        return responseForFile(join(pdfRoot, "web", "pdf_viewer.css"));
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
        const pdfAssetPath = resolveContainedPath(join(pdfRoot, directory), `/${filename}`);
        if (pdfAssetPath && isFile(pdfAssetPath)) return responseForFile(pdfAssetPath);
      }

      const assetPath = resolveContainedPath(publicRoot, url.pathname === "/" ? "/index.html" : url.pathname);
      if (assetPath && isFile(assetPath)) return responseForFile(assetPath);

      return new Response("Not found", { status: 404 });
    },
  });
}
