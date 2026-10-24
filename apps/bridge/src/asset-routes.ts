import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isAbsolute, relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import type { AssetStore } from "./assets.ts";

export const ASSETS_PATH = "/assets/";
/** Where the Rhino plugin puts the meshes of its objects, and the viewer reads them: a store apart from the project's. */
export const MIRROR_PATH = "/mirror/";

export interface AssetRouteContext {
  /** The session token a caller must present. */
  token: string;
  /** The browser origins that may call (the app's own pages). */
  allowedOrigins: string[];
  assets: AssetStore;
  /** The path the store is served under (`/assets/` unless it is the Rhino mirror's). */
  prefix?: string;
  tokensMatch(expected: string, given: string): boolean;
}

const bearer = (req: IncomingMessage): string => {
  const header = req.headers.authorization ?? "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
};

function reply(
  res: ServerResponse,
  status: number,
  message?: string,
  headers: Record<string, string> = {},
): void {
  res
    .writeHead(status, { ...(message ? { "content-type": "application/json" } : {}), ...headers })
    .end(message ? JSON.stringify({ error: message }) : undefined);
}

/**
 * `PUT /assets/<id>` stores an imported model, `GET /assets/<id>` returns it. Both need the session token as a bearer
 * token; a browser call also needs an allowed origin, and the answers carry CORS headers for that origin only, so
 * no other page can read or write a model. The id is checked against the UUID shape before it touches the disk.
 */
export async function handleAssets(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  context: AssetRouteContext,
): Promise<void> {
  const origin = req.headers.origin;
  if (origin && !context.allowedOrigins.includes(origin)) return reply(res, 403, "Origin not allowed.");
  const cors: Record<string, string> = origin
    ? {
        "access-control-allow-origin": origin,
        "access-control-allow-headers": "authorization, content-type",
        "access-control-allow-methods": "GET, PUT, OPTIONS",
        "access-control-max-age": "600",
        vary: "Origin",
      }
    : {};
  if (req.method === "OPTIONS") return reply(res, 204, undefined, cors);
  if (!context.tokensMatch(context.token, bearer(req))) return reply(res, 401, "Unauthorized.", cors);

  const id = path.slice((context.prefix ?? ASSETS_PATH).length);
  if (req.method === "PUT") {
    const result = await context.assets.write(id, req);
    return result.ok ? reply(res, 204, undefined, cors) : reply(res, result.status, result.error, cors);
  }
  if (req.method === "GET") {
    const size = context.assets.size(id);
    const stream = size === null ? null : context.assets.read(id);
    if (size === null || !stream) return reply(res, 404, "No such model.", cors);
    res.writeHead(200, {
      ...cors,
      "content-type": "application/octet-stream",
      "content-length": String(size),
      // An asset never changes under its id.
      "cache-control": "private, max-age=31536000, immutable",
    });
    await pipeline(stream, res);
    return;
  }
  return reply(res, 405, "Method not allowed.", cors);
}

export const PROJECT_FILE_PATH = "/project-file/";

/** The most a project file served to the viewer may be (the importer's own limit). */
const MAX_PROJECT_FILE_BYTES = 500_000_000;

/**
 * The absolute path of a `.3dm` file in the open project, or null when the request is for anything else: a path that
 * leaves the project folder, one inside `.hai` or `.git`, or a file that is not a `.3dm`.
 */
export function projectThreeDmPath(projectDir: string | null, relativePath: string): string | null {
  if (!projectDir || !relativePath || relativePath.includes("\0")) return null;
  const root = resolve(projectDir);
  const target = resolve(root, relativePath);
  const inside = relative(root, target);
  if (!inside || inside.startsWith("..") || isAbsolute(inside)) return null;
  if (inside.split(/[\\/]/).some((part) => part === ".hai" || part === ".git")) return null;
  return target.toLowerCase().endsWith(".3dm") ? target : null;
}

export interface ProjectFileContext {
  token: string;
  allowedOrigins: string[];
  projectDir(): string | null;
  tokensMatch(expected: string, given: string): boolean;
}

/**
 * `GET /project-file/<relative path>` returns a `.3dm` file of the open project, so the viewer can import what a Python
 * run wrote. The session token is required, a browser call needs an allowed origin, and only `.3dm` files inside the
 * project folder are served.
 */
export async function handleProjectFile(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  context: ProjectFileContext,
): Promise<void> {
  const origin = req.headers.origin;
  if (origin && !context.allowedOrigins.includes(origin)) return reply(res, 403, "Origin not allowed.");
  const cors: Record<string, string> = origin
    ? {
        "access-control-allow-origin": origin,
        "access-control-allow-headers": "authorization",
        "access-control-allow-methods": "GET, OPTIONS",
        "access-control-max-age": "600",
        vary: "Origin",
      }
    : {};
  if (req.method === "OPTIONS") return reply(res, 204, undefined, cors);
  if (!context.tokensMatch(context.token, bearer(req))) return reply(res, 401, "Unauthorized.", cors);
  if (req.method !== "GET") return reply(res, 405, "Method not allowed.", cors);
  let relativePath: string;
  try {
    relativePath = decodeURIComponent(path.slice(PROJECT_FILE_PATH.length));
  } catch {
    return reply(res, 400, "Not a valid path.", cors);
  }
  const file = projectThreeDmPath(context.projectDir(), relativePath);
  if (!file || !existsSync(file)) return reply(res, 404, "No such file.", cors);
  const size = statSync(file).size;
  if (size > MAX_PROJECT_FILE_BYTES) return reply(res, 413, "The file is too large to import.", cors);
  res.writeHead(200, { ...cors, "content-type": "application/octet-stream", "content-length": String(size) });
  await pipeline(createReadStream(file), res);
}
