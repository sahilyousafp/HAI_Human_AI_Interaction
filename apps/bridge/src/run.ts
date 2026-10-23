import { join } from "node:path";
import type { AgentProvider } from "@hai/agent-core";
import { loadConfig } from "./config.ts";
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
  bridge.log.info(`listening on http://${address.address}:${address.port} (loopback only)`);

  // Started by the desktop app: tell it where the bridge listens, and stop cleanly when it asks.
  const host = hostLink();
  host?.send({ type: "ready", port: address.port, token: bridge.token });

  let stopping = false;
  async function shutdown() {
    if (stopping) return;
    stopping = true;
    removeSessionFile(config.workspaceRoot);
    await bridge.stop();
    process.exit(0);
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  host?.onStop(shutdown);
}
