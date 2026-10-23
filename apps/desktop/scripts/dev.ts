// `pnpm dev:desktop`: the desktop shell against the web app's dev server, so the page reloads as the code changes.
// The main process, the preload and the bridge are bundled once at start; restart the command to pick up changes
// to them. It uses its own web port (5174, HAI_DESKTOP_WEB_PORT) and its own data folder (.hai/desktop-dev), so it
// does not touch `pnpm dev` or an installed copy of the app.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { bundleBridge, bundleMain, bundlePreload } from "./bundle.ts";

const desktopRoot = join(import.meta.dirname, "..");
const repoRoot = join(desktopRoot, "..", "..");
const webRoot = join(repoRoot, "apps", "web");
const webPort = process.env.HAI_DESKTOP_WEB_PORT ?? "5174";
const devUrl = `http://127.0.0.1:${webPort}`;
const electron: string = createRequire(join(desktopRoot, "package.json"))("electron");

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

// Models and runtimes the page loads from public/ (a no-op when they are in place).
const assets = spawnSync(process.execPath, [join(repoRoot, "scripts", "fetch-assets.mjs")], {
  stdio: "inherit",
});
if (assets.status !== 0)
  fail("Could not place the model files. Fix the error above and run the command again.");

const vite = spawn(process.execPath, [join(webRoot, "node_modules", "vite", "bin", "vite.js")], {
  cwd: webRoot,
  env: { ...process.env, HAI_WEB_PORT: webPort },
  stdio: "inherit",
});
let app: ChildProcess | null = null;
const stopAll = () => {
  app?.kill();
  vite.kill();
};
process.on("SIGINT", () => {
  stopAll();
  process.exit(130);
});
vite.on("exit", (code) => {
  if (app && app.exitCode === null) app.kill();
  if (!app) fail(`The web dev server stopped before the app started (exit code ${code}).`);
});

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 300; i++) {
    try {
      if ((await fetch(devUrl)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  stopAll();
  fail(`The web dev server did not answer on ${devUrl} within a minute.`);
}

await waitForServer();
const dist = join(desktopRoot, "dist");
await bundleMain(dist);
await bundlePreload(dist);
await bundleBridge(join(dist, "bridge"));

app = spawn(electron, [desktopRoot, `--user-data-dir=${join(repoRoot, ".hai", "desktop-dev")}`], {
  env: { ...process.env, HAI_DESKTOP_DEV_URL: devUrl },
  stdio: "inherit",
});
app.on("exit", (code) => {
  vite.kill();
  process.exit(code ?? 0);
});
