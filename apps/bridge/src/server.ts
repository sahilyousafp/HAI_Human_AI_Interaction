import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import type { AgentProvider } from "@aex/agent-core";
import {
  type BridgeStatusMessage,
  type Message,
  PROTOCOL_VERSION,
  parseMessage,
  TOKEN_PROTOCOL_PREFIX,
  WS_PATH,
  WS_PROTOCOL,
} from "@aex/protocol";
import { type WebSocket, WebSocketServer } from "ws";
import { AgentHub } from "./agent/agent-hub.ts";
import { ApprovalBroker } from "./agent/approvals.ts";
import { ExtensionHub } from "./agent/extensions.ts";
import { ViewContext } from "./agent/view-context.ts";
import { assertLoopback } from "./config.ts";
import { createLogger, type Logger, silentLogger } from "./log.ts";
import { createMcpHandler, MCP_PATH } from "./mcp/mcp-endpoint.ts";
import { createSceneMcpServer } from "./mcp/scene-tools.ts";
import { SceneHub, type SceneHubOptions } from "./scene-hub.ts";
import { SettingsHub } from "./settings.ts";

export interface BridgeOptions {
  host: string;
  port: number;
  allowedOrigins: string[];
  version: string;
  token?: string;
  scene?: SceneHubOptions;
  /** Where user settings are kept (.aex/settings.json); without one they live in memory. */
  settingsFile?: string;
  /** The user's agent (their own Claude Code); without one, the agent panel says it is not set up. */
  agent?: { provider: AgentProvider; idleMs?: number };
  /** Writes one log line (redacted: never secrets or the session token); without it, nothing is logged. */
  log?: (line: string) => void;
}

export interface Bridge {
  readonly token: string;
  readonly startedAt: string;
  readonly scene: SceneHub;
  readonly agent: AgentHub | null;
  readonly approvals: ApprovalBroker;
  readonly extensions: ExtensionHub;
  readonly log: Logger;
  start(): Promise<AddressInfo>;
  stop(): Promise<void>;
}

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

function tokensMatch(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** What clients are told when this bridge runs without an agent. */
const agentNotSetUp = (): Message => ({
  type: "agent.transcript",
  id: randomUUID(),
  payload: {
    turns: [],
    pending: [],
    status: {
      state: "unavailable",
      reason: "The agent is not set up in this bridge.",
      fix: "Start the app with pnpm dev.",
    },
  },
});

function reject(socket: Duplex, status: 401 | 403 | 404, reason: string): void {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

export function createBridge(options: BridgeOptions): Bridge {
  assertLoopback(options.host);
  const token = options.token ?? createSessionToken();
  const startedAt = new Date().toISOString();
  const wss = new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols) => (protocols.has(WS_PROTOCOL) ? WS_PROTOCOL : false),
  });
  const clients = new Set<WebSocket>();

  const statusMessage = (): BridgeStatusMessage => ({
    type: "bridge.status",
    id: randomUUID(),
    payload: {
      protocolVersion: PROTOCOL_VERSION,
      bridgeVersion: options.version,
      startedAt,
      clients: clients.size,
    },
  });

  const broadcast = (message: Message) => {
    const frame = JSON.stringify(message);
    for (const client of clients) client.send(frame);
  };
  const broadcastStatus = () => broadcast(statusMessage());
  // The open project's always-allow list goes out again when another project opens (set once approvals exist).
  let projectOpened = () => {};
  const scene = new SceneHub(
    {
      ...options.scene,
      onProjectOpened: (project) => {
        options.scene?.onProjectOpened?.(project);
        projectOpened();
      },
    },
    broadcast,
  );
  const settings = new SettingsHub(options.settingsFile ?? null, broadcast);
  const view = new ViewContext(() => clients.size, broadcast);
  let port = options.port;
  const log = options.log ? createLogger(options.log, () => [token]) : silentLogger;
  const approvals = new ApprovalBroker({ projectDir: () => scene.projectDir, log }, broadcast);
  projectOpened = () => {
    approvals.announce();
    extensions.projectChanged();
  };
  const agent = options.agent
    ? new AgentHub(
        {
          provider: options.agent.provider,
          projectDir: () => scene.projectDir,
          mcp: () => ({ url: `http://${options.host}:${port}${MCP_PATH}`, token }),
          ...(options.agent.idleMs ? { idleMs: options.agent.idleMs } : {}),
          pending: () => approvals.waiting,
          log,
          hooks: {
            started: (turn) => scene.beginTurn(turn.request),
            stopping: () => approvals.denyAll("The user stopped the request."),
            ended: () => {
              approvals.denyAll("The request ended before the user answered.");
              scene.endTurn();
            },
            initialized: (event) => extensions.initialized(event),
          },
        },
        broadcast,
      )
    : null;
  const extensions = new ExtensionHub(
    {
      projectDir: () => scene.projectDir,
      provider: options.agent?.provider ?? null,
      restart: async () => agent?.restart(),
      log,
    },
    broadcast,
  );

  const handleMcp = createMcpHandler({
    tokenMatches: (presented) => tokensMatch(token, presented),
    allowedOrigins: options.allowedOrigins,
    createServer: () =>
      createSceneMcpServer({
        doc: () => scene.scene.doc,
        selection: () => scene.scene.selection,
        apply: (ops) => scene.applyFromAgent(ops),
        approve: (tool, input, toolUseId) => approvals.decide(tool, input, toolUseId),
        setSelection: (ids) => scene.select(ids),
        userContext: () => view.current,
        captureView: () => view.capture(),
      }),
  });

  const server: Server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (req.method === "GET" && path === "/health") {
      res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
      return;
    }
    if (path === MCP_PATH) {
      handleMcp(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(500).end();
      });
      return;
    }
    res.writeHead(404).end();
  });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (new URL(req.url ?? "/", "http://localhost").pathname !== WS_PATH)
      return reject(socket, 404, "Not Found");
    const origin = req.headers.origin;
    if (!origin || !options.allowedOrigins.includes(origin)) return reject(socket, 403, "Forbidden");
    const offered = (req.headers["sec-websocket-protocol"] ?? "").split(",").map((p) => p.trim());
    const tokenEntry = offered.find((p) => p.startsWith(TOKEN_PROTOCOL_PREFIX));
    if (!tokenEntry || !tokensMatch(token, tokenEntry.slice(TOKEN_PROTOCOL_PREFIX.length))) {
      return reject(socket, 401, "Unauthorized");
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (ws: WebSocket) => {
    let greeted = false;
    const send = (message: Message) => ws.send(JSON.stringify(message));
    ws.on("message", (data) => {
      const result = parseMessage(data.toString());
      if (!result.ok) {
        ws.close(1008, "Invalid message");
        return;
      }
      const message = result.message;
      if (message.type === "hello") {
        if (greeted) return;
        greeted = true;
        clients.add(ws);
        broadcastStatus();
        scene.greet(send);
        settings.greet(send);
        approvals.announce(send);
        extensions.greet(send);
        if (agent) agent.greet(send);
        else send(agentNotSetUp());
        return;
      }
      // Nothing but hello is accepted before a client has said hello.
      if (!greeted) {
        ws.close(1008, "Say hello first");
        return;
      }
      if (scene.handle(message, send) || settings.handle(message) || view.handle(message)) return;
      if (approvals.handle(message) || extensions.handle(message, send)) return;
      agent?.handle(message, send);
    });
    ws.on("close", () => {
      if (clients.delete(ws)) broadcastStatus();
    });
  });

  return {
    token,
    startedAt,
    scene,
    agent,
    approvals,
    extensions,
    log,
    start: () =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(options.port, options.host, () => {
          const address = server.address() as AddressInfo;
          port = address.port;
          resolve(address);
        });
      }),
    stop: async () => {
      await agent?.close();
      await scene.flush();
      await new Promise<void>((resolve) => {
        for (const client of wss.clients) client.terminate();
        wss.close();
        server.close(() => resolve());
      });
    },
  };
}
