import { statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

import { MAXIMUM_PDF_FILE_SIZE } from "./lib/files.ts";
import { SessionNotFoundError, SessionStore, type SessionStoreOptions } from "./session-store.ts";

export interface AppServerOptions {
  port?: number;
  hostname?: string;
  development?: boolean;
  root?: string;
  sessionStore?: SessionStore;
  sessionRoot?: SessionStoreOptions["root"];
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

async function readRequestBytes(request: Request, maximumSize: number): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
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
        return responseForFile(join(root, "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs"));
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
