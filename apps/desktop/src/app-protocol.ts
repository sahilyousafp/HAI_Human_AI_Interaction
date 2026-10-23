import { createReadStream, statSync } from "node:fs";
import { extname, join } from "node:path";
import { Readable } from "node:stream";

export interface AppRoots {
  /** The built web app (apps/web/dist) in the install folder. */
  web: string;
  /** Where first-run downloads put the voice models; answers `/models/*` before `web` does. */
  models: string;
}

const MODELS_PREFIX = "/models/";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".onnx": "application/octet-stream",
  ".task": "application/octet-stream",
  ".bin": "application/octet-stream",
};

/**
 * What the page may load and connect to. Scripts and workers come from the app itself; WebAssembly needs
 * `wasm-unsafe-eval`; the bridge is on loopback; nothing else on the network is reachable from the page.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob: mediastream:",
  "font-src 'self' data:",
  "connect-src 'self' blob: data: ws://127.0.0.1:* http://127.0.0.1:*",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

/**
 * The path segments of a request path, or null when the path could leave the folder it is looked up in: a dot
 * segment (also percent-encoded), a backslash, a drive letter or a NUL anywhere.
 */
export function safeSegments(pathname: string): string[] | null {
  const segments: string[] = [];
  for (const raw of pathname.split("/")) {
    if (raw === "") continue;
    let segment: string;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (segment === "." || segment === ".." || /[\\/:\0]/.test(segment)) return null;
    segments.push(segment);
  }
  return segments;
}

function fileSize(file: string): number | null {
  try {
    const stat = statSync(file);
    return stat.isFile() ? stat.size : null;
  } catch {
    return null;
  }
}

/** The file a request path names, looking in the downloaded models first for `/models/*`. */
export function resolveAppFile(pathname: string, roots: AppRoots): { file: string; size: number } | null {
  const segments = safeSegments(pathname);
  if (!segments) return null;
  const relative = segments.length === 0 ? ["index.html"] : segments;
  const candidates = pathname.startsWith(MODELS_PREFIX)
    ? [join(roots.models, ...relative.slice(1)), join(roots.web, ...relative)]
    : [join(roots.web, ...relative)];
  for (const file of candidates) {
    const size = fileSize(file);
    if (size !== null) return { file, size };
  }
  return null;
}

/** Answers requests to the app's own scheme from the install folder and the downloaded models. */
export function createAppHandler(roots: AppRoots): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
    }
    const found = resolveAppFile(new URL(request.url).pathname, roots);
    if (!found) return new Response("not found", { status: 404 });
    const headers = {
      "content-type": TYPES[extname(found.file).toLowerCase()] ?? "application/octet-stream",
      "content-length": String(found.size),
      "content-security-policy": CONTENT_SECURITY_POLICY,
      "x-content-type-options": "nosniff",
    };
    if (request.method === "HEAD") return new Response(null, { headers });
    return new Response(Readable.toWeb(createReadStream(found.file)) as ReadableStream, { headers });
  };
}
