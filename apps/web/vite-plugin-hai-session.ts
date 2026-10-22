import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Plugin } from "vite";

function findWorkspaceRoot(start: string): string {
  let dir = resolve(start);
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
  return dir;
}

/**
 * Injects the bridge port and session token into index.html in dev.
 * Read on every page load, so a restarted bridge (new token) is picked up by a reload.
 * HAI_WORKSPACE points at another bridge's workspace, as the end-to-end tests' own bridge and dev server use.
 */
export function haiSession(): Plugin {
  const workspace = process.env.HAI_WORKSPACE
    ? resolve(process.env.HAI_WORKSPACE)
    : findWorkspaceRoot(process.cwd());
  const sessionFile = join(workspace, ".hai", "session.json");
  return {
    name: "hai-session",
    apply: "serve",
    transformIndexHtml() {
      let session: { port: number; token: string } | null = null;
      if (existsSync(sessionFile)) {
        try {
          const raw = JSON.parse(readFileSync(sessionFile, "utf8"));
          session = { port: raw.port, token: raw.token };
        } catch {
          session = null;
        }
      }
      return [
        {
          tag: "script",
          children: `window.__HAI_SESSION__ = ${JSON.stringify(session)};`,
          injectTo: "head-prepend",
        },
      ];
    },
  };
}
