import { join } from "node:path";
import type { AgentProvider } from "@hai/agent-core";
import { loadConfig } from "./config.ts";
import { discoveryFilePath, removeDiscoveryFile, writeDiscoveryFile } from "./discovery-file.ts";
import { hostLink } from "./host-link.ts";
import { migrateLegacyFolder } from "./legacy.ts";
import { defaultProjectDir, readLastProject, writeLastProject } from "./project.ts";
import { createBridge } from "./server.ts";
import { removeSessionFile, writeSessionFile } from "./session-file.ts";

// The desktop app tells the bridge which version it is (HAI_APP_VERSION); run from the repository there is no installed version.
const VERSION = process.env.HAI_APP_VERSION ?? "0.0.0";

/**
 * Starts the bridge as a program: reads its settings from the environment, listens, writes the session file, tells
 * the desktop app that started it (if any) where it listens, and stops cleanly on a signal or when that app asks.
 * Split from main.ts so a test can run all of this with a stand-in for the Claude Code CLI.
 */
export async function runBridge(provider: AgentProvider): Promise<void> {
  const config = loadConfig();
  migrateLegacyFolder(config.workspaceRoot); // what an older version, named AEX, kept in `.aex`
  const bridge = createBridge({
    host: config.host,
    port: config.port,
    allowedOrigins: config.allowedOrigins,
    version: VERSION,
    settingsFile: join(config.workspaceRoot, ".hai", "settings.json"),
    mirrorDir: join(config.workspaceRoot, ".hai", "mirror"),
    agent: { provider },
    log: (line) => console.log(line),
    scene: {
      projectDir: readLastProject(config.workspaceRoot) ?? defaultProjectDir(config.workspaceRoot),
      onProjectOpened: (project) => writeLastProject(config.workspaceRoot, project.path),
    },
  });

  const address = await bridge.start();
  writeSessionFile(config.workspaceRoot, {
    port: address.port,
    token: bridge.token,
    pid: process.pid,
    startedAt: bridge.startedAt,
  });
  // The Rhino plugin finds the bridge through this file in the user's own application data.
  const discovery = discoveryFilePath();
  const own = { pid: process.pid, token: bridge.token };
  const written = writeDiscoveryFile(discovery, { port: address.port, startedAt: bridge.startedAt, ...own });
  if (written.warning) bridge.log.info(written.warning);
  bridge.log.info(`listening on http://${address.address}:${address.port} (loopback only)`);

  // Started by the desktop app: tell it where the bridge listens, and stop cleanly when it asks.
  const host = hostLink();
  host?.send({ type: "ready", port: address.port, token: bridge.token });

  let stopping = false;
  async function shutdown() {
    if (stopping) return;
    stopping = true;
    removeSessionFile(config.workspaceRoot);
    removeDiscoveryFile(discovery, own);
    await bridge.stop();
    process.exit(0);
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  host?.onStop(shutdown);
}
