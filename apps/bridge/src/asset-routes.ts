import type { IncomingMessage, ServerResponse } from "node:http";
import { pipeline } from "node:stream/promises";
import type { AssetStore } from "./assets.ts";

export const ASSETS_PATH = "/assets/";

export interface AssetRouteContext {
  /** The session token a caller must present. */
  token: string;
  /** The browser origins that may call (the app's own pages). */
  allowedOrigins: string[];
  assets: AssetStore;
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

  const id = path.slice(ASSETS_PATH.length);
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
