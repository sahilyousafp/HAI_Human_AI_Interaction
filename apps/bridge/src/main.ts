import { join } from "node:path";
import { loadConfig } from "./config.ts";
import { defaultProjectDir, readLastProject, writeLastProject } from "./project.ts";
import { createBridge } from "./server.ts";
import { removeSessionFile, writeSessionFile } from "./session-file.ts";

const VERSION = "0.0.0";

const config = loadConfig();
const bridge = createBridge({
  host: config.host,
  port: config.port,
  allowedOrigins: config.allowedOrigins,
  version: VERSION,
  settingsFile: join(config.workspaceRoot, ".aex", "settings.json"),
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
console.log(`Bridge listening on http://${address.address}:${address.port} (loopback only)`);

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
