import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
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
import { assertLoopback } from "./config.ts";
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
}

export interface Bridge {
  readonly token: string;
  readonly startedAt: string;
  readonly scene: SceneHub;
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
  const scene = new SceneHub(options.scene ?? {}, broadcast);
  const settings = new SettingsHub(options.settingsFile ?? null, broadcast);

  const server: Server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
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
        return;
      }
      // Nothing but hello is accepted before a client has said hello.
      if (!greeted) {
        ws.close(1008, "Say hello first");
        return;
      }
      if (!scene.handle(message, send)) settings.handle(message);
    });
    ws.on("close", () => {
      if (clients.delete(ws)) broadcastStatus();
    });
  });

  return {
    token,
    startedAt,
    scene,
    start: () =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(options.port, options.host, () => resolve(server.address() as AddressInfo));
      }),
    stop: async () => {
      await scene.flush();
      await new Promise<void>((resolve) => {
        for (const client of wss.clients) client.terminate();
        wss.close();
        server.close(() => resolve());
      });
    },
  };
}
