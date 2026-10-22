import { join } from "node:path";
import { ClaudeCliProvider } from "@hai/agent-core";
import { loadConfig } from "./config.ts";
import { migrateLegacyFolder } from "./legacy.ts";
import { defaultProjectDir, readLastProject, writeLastProject } from "./project.ts";
import { createBridge } from "./server.ts";
import { removeSessionFile, writeSessionFile } from "./session-file.ts";

const VERSION = "0.0.0";

const config = loadConfig();
migrateLegacyFolder(config.workspaceRoot); // what an older version, named AEX, kept in `.aex`
const bridge = createBridge({
  host: config.host,
  port: config.port,
  allowedOrigins: config.allowedOrigins,
  version: VERSION,
  settingsFile: join(config.workspaceRoot, ".hai", "settings.json"),
  // The user's own Claude Code: the installed, self-logged-in CLI, started unmodified.
  agent: { provider: new ClaudeCliProvider() },
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
