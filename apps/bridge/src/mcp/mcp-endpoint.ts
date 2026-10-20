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
  /** A fresh MCP server with the calling agent's tools; one per request (stateless). */
  createServer(caller: Caller): McpServer;
}

function deny(res: ServerResponse, status: 401 | 403, message: string): void {
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
export function createMcpHandler(options: McpEndpointOptions) {
  const validateHost = localhostHostValidation();
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!validateHost(req, res)) return; // answered 403 itself
    const origin = req.headers.origin;
    if (origin && !options.allowedOrigins.includes(origin)) return deny(res, 403, "Origin not allowed");
    const auth = req.headers.authorization ?? "";
    const presented = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
    const caller = presented ? options.identify(presented) : null;
    if (!caller) return deny(res, 401, "Missing or wrong agent token");

    const server = options.createServer(caller);
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  };
}
