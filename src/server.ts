import { statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

export interface AppServerOptions {
  port?: number;
  hostname?: string;
  development?: boolean;
  root?: string;
}

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".icc": "application/vnd.iccprofile",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".pdf": "application/pdf",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

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

  return Bun.serve({
    port: options.port ?? Number(Bun.env.PORT ?? 8881),
    hostname: options.hostname ?? "127.0.0.1",
    development: options.development ?? Bun.env.NODE_ENV !== "production",
    async fetch(request) {
      const url = new URL(request.url);

      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
      }

      if (url.pathname === "/health") {
        return Response.json({ status: "ok" });
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

      const pdfAssetDirectories: Record<string, string> = {
        "/assets/cmaps/": "cmaps",
        "/assets/iccs/": "iccs",
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
