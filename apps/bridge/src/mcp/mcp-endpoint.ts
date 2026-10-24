import type { IncomingMessage, ServerResponse } from "node:http";
import { localhostHostValidation, NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import type { McpServer } from "@modelcontextprotocol/server";
import type { Caller } from "./agent-tokens.ts";

/** The path the agent reaches the app's scene tools on. */
export const MCP_PATH = "/mcp";

export interface McpEndpointOptions {
  /** The agent a presented token was issued to (in constant time), or null. */
  identify(presented: string): Caller | null;
  allowedOrigins: string[];
  /**
   * A fresh MCP server with the calling agent's tools; one per request (stateless). `closed` is aborted when the agent
   * ends the request before it is answered (it pressed Stop, or its process went), so a long tool call can stop its work.
   */
  createServer(caller: Caller, closed: AbortSignal): McpServer;
}

function deny(res: ServerResponse, status: 400 | 401 | 403, message: string): void {
  res
    .writeHead(status, { "content-type": "application/json" })
    .end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message }, id: null }));
}

/**
 * The bridge's MCP endpoint (streamable HTTP, stateless). Every request must carry an agent's own token as a bearer
 * token, address the bridge as localhost (no DNS rebinding) and, if a browser sent it, come from an allowed origin.
 * Anything else is refused before any tool can run. The token says which agent is calling, and the server it gets
 * offers only that agent's tools.
 */
/** The most an MCP request body may be (a script is at most 200 000 characters). */
const MAX_BODY_BYTES = 2_000_000;

/** Reads a request's JSON body, or null if it has none, is too large or is not JSON. */
async function readJson(req: IncomingMessage): Promise<unknown> {
  if (req.method !== "POST") return undefined;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

export function createMcpHandler(options: McpEndpointOptions) {
  const validateHost = localhostHostValidation();
  // The tool calls being answered, so a `notifications/cancelled` (another request, to another stateless server) can
  // end the right one: keyed by the agent and the request id.
  const inflight = new Map<string, AbortController>();
  const key = (agent: string | null, id: unknown) => `${agent ?? ""}:${String(id)}`;
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!validateHost(req, res)) return; // answered 403 itself
    const origin = req.headers.origin;
    if (origin && !options.allowedOrigins.includes(origin)) return deny(res, 403, "Origin not allowed");
    const auth = req.headers.authorization ?? "";
    const presented = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
    const caller = presented ? options.identify(presented) : null;
    if (!caller) return deny(res, 401, "Missing or wrong agent token");

    const closed = new AbortController();
    const body = await readJson(req);
    if (body === null) return deny(res, 400, "The request body is not JSON or is too large");
    const messages = (Array.isArray(body) ? body : body === undefined ? [] : [body]) as Array<{
      id?: unknown;
      method?: string;
      params?: { requestId?: unknown };
    }>;
    for (const message of messages) {
      if (message?.method === "notifications/cancelled" && message.params?.requestId !== undefined) {
        inflight.get(key(caller.agent, message.params.requestId))?.abort();
      }
    }
    const mine = messages
      .filter((m) => m?.method === "tools/call" && m.id !== undefined)
      .map((m) => key(caller.agent, m.id));
    for (const id of mine) inflight.set(id, closed);

    const server = options.createServer(caller, closed.signal);
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      for (const id of mine) if (inflight.get(id) === closed) inflight.delete(id);
      if (!res.writableFinished) closed.abort();
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  };
}
