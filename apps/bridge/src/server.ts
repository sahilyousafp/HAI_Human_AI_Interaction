import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import type { AgentProvider } from "@hai/agent-core";
import {
  type BridgeStatusMessage,
  type Message,
  PROTOCOL_VERSION,
  parseMessage,
  type RhinoHello,
  TOKEN_PROTOCOL_PREFIX,
  WS_PATH,
  WS_PROTOCOL,
} from "@hai/protocol";
import { type WebSocket, WebSocketServer } from "ws";
import { ApprovalBroker } from "./agent/approvals.ts";
import { ExtensionHub } from "./agent/extensions.ts";
import { PanelBroker } from "./agent/panels.ts";
import { Team } from "./agent/team.ts";
import { ViewContext } from "./agent/view-context.ts";
import {
  ASSETS_PATH,
  handleAssets,
  handleProjectFile,
  MIRROR_PATH,
  PROJECT_FILE_PATH,
  projectThreeDmPath,
} from "./asset-routes.ts";
import { AssetStore } from "./assets.ts";
import { assertLoopback } from "./config.ts";
import { createLogger, type Logger, silentLogger } from "./log.ts";
import { AgentTokens } from "./mcp/agent-tokens.ts";
import { createMcpHandler, MCP_PATH } from "./mcp/mcp-endpoint.ts";
import { RHINO_DOCUMENT_SCRIPT, requirementPackages } from "./mcp/rhino-tools.ts";
import { createSceneMcpServer } from "./mcp/scene-tools.ts";
import { PythonEnv } from "./python/python-env.ts";
import { PythonWorkbench } from "./python/python-run.ts";
import { RhinoLink } from "./rhino-link.ts";
import { SceneHub, type SceneHubOptions } from "./scene-hub.ts";
import { SettingsHub } from "./settings.ts";

export interface BridgeOptions {
  host: string;
  port: number;
  allowedOrigins: string[];
  version: string;
  token?: string;
  scene?: SceneHubOptions;
  /** Where user settings are kept (.hai/settings.json); without one they live in memory. */
  settingsFile?: string;
  /** The user's agents (their own Claude Code); without one, the agent panel says it is not set up. */
  agent?: { provider: AgentProvider; idleMs?: number; maxRunning?: number };
  /** Where `hai_run.py` and `hai_3dm.py` are (HAI_PYTHON_HELPERS, or the `python` folder of the bridge). */
  pythonHelperDir?: string;
  /** Where an environment whose project path is too long goes (tests give their own). */
  pythonFallbackRoot?: string;
  /** A ready-made environment (tests share one); the project's own is made on first use otherwise. */
  pythonEnv?: PythonEnv;
  /** Where the meshes of Rhino's objects are kept while it is connected (`.hai/mirror`); without one nothing is mirrored. */
  mirrorDir?: string;
  /** Writes one log line (redacted: never secrets or the session token); without it, nothing is logged. */
  log?: (line: string) => void;
}

export interface Bridge {
  readonly token: string;
  readonly startedAt: string;
  readonly scene: SceneHub;
  /** The agent team: Mochi and the specialists. */
  readonly agent: Team | null;
  readonly approvals: ApprovalBroker;
  /** Rhino: its connection, the mirror of its objects and the way the agent models. */
  readonly rhino: RhinoLink;
  /** The Python workbench: the managed environment and the runner. */
  readonly python: PythonWorkbench;
  readonly pythonEnv: PythonEnv;
  /** Generated panels: the offer, and the one panel that may be open. */
  readonly panels: PanelBroker;
  readonly extensions: ExtensionHub;
  /** The running agents' MCP tokens (the session token is for browsers only). */
  readonly agentTokens: AgentTokens;
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
  // Set once the panels exist: the Generated panels switch closes an open panel.
  let panelsChanged = (_on: boolean) => {};
  const mirrorAssets = new AssetStore(() => options.mirrorDir ?? null);
  const settings = new SettingsHub(options.settingsFile ?? null, broadcast, (feature, on) => {
    if (feature === "generatedPanels") panelsChanged(on);
  });
  const view = new ViewContext(() => clients.size, broadcast);
  let port = options.port;
  const agentTokens = new AgentTokens();
  const log = options.log ? createLogger(options.log, () => [token, ...agentTokens.current]) : silentLogger;
  const pythonEnv =
    options.pythonEnv ??
    new PythonEnv({
      projectDir: () => scene.projectDir,
      ...(options.pythonFallbackRoot ? { fallbackRoot: options.pythonFallbackRoot } : {}),
    });
  const python = new PythonWorkbench({
    env: pythonEnv,
    projectDir: () => scene.projectDir,
    helperDir:
      options.pythonHelperDir ?? process.env.HAI_PYTHON_HELPERS ?? join(import.meta.dirname, "..", "python"),
  });
  const approvals = new ApprovalBroker(
    {
      projectDir: () => scene.projectDir,
      log,
      // What a code run would install: the starting packages on first use plus what it names; for Rhino, its "# r:" lines.
      pythonInstalls: (tool, input) =>
        tool.endsWith("__rhino_run_python")
          ? requirementPackages(typeof input.code === "string" ? input.code : "").packages
          : pythonEnv.wouldInstall(
              Array.isArray(input.packages)
                ? input.packages.filter((p): p is string => typeof p === "string")
                : [],
            ),
    },
    (message) => {
      broadcast(message);
      agent?.approvalsChanged();
    },
  );
  const rhino = new RhinoLink(
    {
      mode: () => settings.modelling,
      assets: {
        has: (id) => mirrorAssets.has(id),
        remove: (id) => mirrorAssets.remove(id),
        clear: () => mirrorAssets.clearAll(),
      },
      log,
      // Agents list their tools when their process starts: restart them so the Rhino tools appear or go.
      availabilityChanged: () => void agent?.restart(),
    },
    broadcast,
  );
  const panels = new PanelBroker({ log, closed: (closure) => agent?.panelClosed(closure) }, broadcast);
  panelsChanged = (on) => {
    if (!on) panels.switchedOff();
    // Agents list their tools when their process starts: restart them so the panel tools appear or go.
    void agent?.restart();
  };
  projectOpened = () => {
    approvals.announce();
    extensions.projectChanged();
  };
  const agent: Team | null = options.agent
    ? new Team(
        {
          provider: options.agent.provider,
          projectDir: () => scene.projectDir,
          mcpUrl: () => `http://${options.host}:${port}${MCP_PATH}`,
          tokens: agentTokens,
          scene,
          approvals,
          panels,
          initialized: (event) => extensions.initialized(event),
          ...(options.agent.idleMs ? { idleMs: options.agent.idleMs } : {}),
          ...(options.agent.maxRunning ? { maxRunning: options.agent.maxRunning } : {}),
          log,
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
    identify: (presented) => agentTokens.identify(presented),
    allowedOrigins: options.allowedOrigins,
    createServer: (caller, closed) =>
      createSceneMcpServer(
        {
          requestSignal: closed,
          doc: () => scene.scene.doc,
          selection: () => scene.scene.selection,
          apply: (ops) => scene.applyFromAgent(ops),
          approve: (tool, input, toolUseId, agent) => approvals.decide(tool, input, toolUseId, agent),
          setSelection: (ids) => scene.select(ids),
          userContext: () => view.current,
          captureView: (sun) => view.capture(sun),
          setView: (request) => view.setView(request),
          python: {
            run: async (input, signal) => {
              const out = await python.run({ ...input, signal });
              // A run that wrote .3dm files lets the pages offer to import them or open them in Rhino.
              if (out.written.length > 0) {
                broadcast({
                  type: "python.written",
                  id: randomUUID(),
                  payload: {
                    files: out.written,
                    script: out.script,
                    ...(input.agent ? { agent: input.agent } : {}),
                  },
                });
              }
              return out;
            },
          },
          ...(rhino.inUse === "rhino"
            ? {
                rhinoPython: {
                  run: async (input, signal) => {
                    const requirements = requirementPackages(input.code).packages;
                    try {
                      const pending = rhino.runPython(input.code, input.timeoutMs);
                      const stopped = new Promise<never>((_resolve, reject) =>
                        signal.addEventListener("abort", () => reject(new Error("The run was stopped.")), {
                          once: true,
                        }),
                      );
                      const out = await Promise.race([pending, stopped]);
                      const script = python.record(
                        { ...input, packages: requirements },
                        {
                          ...out,
                          ...(out.result !== undefined ? { result: out.result } : {}),
                          ...(out.error ? { error: out.error } : {}),
                        },
                      );
                      return {
                        ok: out.ok,
                        stdout: out.stdout,
                        ...(out.result !== undefined ? { result: out.result } : {}),
                        ...(out.error ? { error: out.error } : {}),
                        durationMs: out.durationMs,
                        script,
                      };
                    } catch (error) {
                      const message = (error as Error).message;
                      const script = python.record(
                        { ...input, packages: requirements },
                        {
                          ok: false,
                          stdout: "",
                          error: message,
                          durationMs: 0,
                          stopped: message === "The run was stopped.",
                        },
                      );
                      return { ok: false, stdout: "", error: message, durationMs: 0, script };
                    }
                  },
                  document: async (signal) => {
                    try {
                      const pending = rhino.runPython(RHINO_DOCUMENT_SCRIPT, 15_000);
                      const stopped = new Promise<never>((_resolve, reject) =>
                        signal.addEventListener("abort", () => reject(new Error("The read was stopped.")), {
                          once: true,
                        }),
                      );
                      const out = await Promise.race([pending, stopped]);
                      return out.ok && out.result
                        ? { ok: true as const, json: out.result }
                        : { ok: false as const, error: out.error ?? "Rhino did not answer." };
                    } catch (error) {
                      return { ok: false as const, error: (error as Error).message };
                    }
                  },
                },
              }
            : {}),
          ...(rhino.mirrored
            ? { rhino: { object: (id) => rhino.object(id), selection: () => rhino.selection } }
            : {}),
          ...(agent ? { team: agent.tools } : {}),
          ...(settings.featureOn("generatedPanels")
            ? {
                panels: {
                  offer: (purpose) => panels.offer(caller.agent, purpose),
                  open: (document) => panels.open(caller.agent, document),
                  update: (patch) => panels.update(caller.agent, patch),
                  close: () => panels.close(caller.agent),
                },
              }
            : {}),
        },
        caller,
      ),
  });

  const server: Server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (req.method === "GET" && path === "/health") {
      res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
      return;
    }
    if (path.startsWith(PROJECT_FILE_PATH)) {
      handleProjectFile(req, res, path, {
        token,
        allowedOrigins: options.allowedOrigins,
        projectDir: () => scene.projectDir,
        tokensMatch,
      }).catch(() => {
        if (!res.headersSent) res.writeHead(500).end();
      });
      return;
    }
    if (path.startsWith(MIRROR_PATH)) {
      handleAssets(req, res, path, {
        token,
        allowedOrigins: options.allowedOrigins,
        assets: mirrorAssets,
        prefix: MIRROR_PATH,
        tokensMatch,
      }).catch(() => {
        if (!res.headersSent) res.writeHead(500).end();
      });
      return;
    }
    if (path.startsWith(ASSETS_PATH)) {
      handleAssets(req, res, path, {
        token,
        allowedOrigins: options.allowedOrigins,
        assets: scene.assets,
        tokensMatch,
      }).catch(() => {
        if (!res.headersSent) res.writeHead(500).end();
      });
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
    // A browser always sends an Origin and it must be the app's own. A program on this machine (the Rhino plugin)
    // sends none and is accepted only with the token, and only to say hello as the Rhino client.
    const origin = req.headers.origin;
    if (origin && !options.allowedOrigins.includes(origin)) return reject(socket, 403, "Forbidden");
    const offered = (req.headers["sec-websocket-protocol"] ?? "").split(",").map((p) => p.trim());
    const tokenEntry = offered.find((p) => p.startsWith(TOKEN_PROTOCOL_PREFIX));
    if (!tokenEntry || !tokensMatch(token, tokenEntry.slice(TOKEN_PROTOCOL_PREFIX.length))) {
      return reject(socket, 401, "Unauthorized");
    }
    const local = !origin;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req, local));
  });

  wss.on("connection", (ws: WebSocket, _req: IncomingMessage, local: boolean) => {
    let greeted = false;
    /** Set when this connection is the Rhino plugin. */
    let rhinoConnection: { send(m: Message): void; close(): void; hello: RhinoHello } | null = null;
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
        // Only a local program may say it is Rhino, and a local program may say nothing else: a web page cannot
        // pretend to be the plugin, and the plugin gets none of the browser's messages.
        if ((message.payload.client === "rhino") !== local) {
          ws.close(1008, "Wrong client for this connection");
          return;
        }
        greeted = true;
        if (message.payload.client === "rhino") {
          // The plugin is not a page: it gets none of the pages' messages and counts as no client.
          rhinoConnection = {
            send,
            close: () => ws.close(1000, "Replaced by a newer connection"),
            hello: message.payload,
          };
          rhino.attach(rhinoConnection);
          send(statusMessage());
          return;
        }
        clients.add(ws);
        broadcastStatus();
        scene.greet(send);
        settings.greet(send);
        approvals.announce(send);
        panels.greet(send);
        rhino.greet(send);
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
      if (rhinoConnection) {
        // The plugin may report on Rhino and answer its runs, and nothing else.
        if (!rhino.handleFromRhino(message)) ws.close(1008, "Not a message for the Rhino client");
        return;
      }
      if (message.type === "settings.set" && message.payload.modelling !== undefined) {
        settings.handle(message);
        rhino.modeChanged();
        return;
      }
      if (message.type === "rhino.open") {
        // A page names a file in the project; the plugin is given the absolute path, only for a .3dm inside it.
        const file = projectThreeDmPath(scene.projectDir, message.payload.path);
        if (file) rhino.open(file);
        else
          send({
            type: "request.error",
            id: randomUUID(),
            payload: { requestId: message.id, message: "That is not a .3dm file in the project." },
          });
        return;
      }
      if (rhino.handleFromWeb(message)) return;
      if (scene.handle(message, send) || settings.handle(message) || view.handle(message)) return;
      if (approvals.handle(message) || panels.handle(message) || extensions.handle(message, send)) return;
      agent?.handle(message, send);
    });
    ws.on("close", () => {
      if (rhinoConnection) rhino.detach(rhinoConnection);
      if (clients.delete(ws)) broadcastStatus();
      // With no page left, nothing can show or answer a panel: an open one closes and drops its preview.
      if (clients.size === 0) panels.clientsGone();
    });
  });

  return {
    token,
    startedAt,
    scene,
    agent,
    approvals,
    rhino,
    python,
    pythonEnv,
    panels,
    extensions,
    agentTokens,
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
