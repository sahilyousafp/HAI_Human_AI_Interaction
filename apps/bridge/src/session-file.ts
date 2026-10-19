import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface SessionInfo {
  port: number;
  token: string;
  pid: number;
  startedAt: string;
}

export function sessionFilePath(workspaceRoot: string): string {
  return join(workspaceRoot, ".aex", "session.json");
}

/** Hands the port and token to the local dev server. `.aex/` is git-ignored. */
export function writeSessionFile(workspaceRoot: string, info: SessionInfo): string {
  const path = sessionFilePath(workspaceRoot);
  mkdirSync(join(workspaceRoot, ".aex"), { recursive: true });
  writeFileSync(path, `${JSON.stringify(info, null, 2)}\n`, { mode: 0o600 });
  return path;
}

export function removeSessionFile(workspaceRoot: string): void {
  rmSync(sessionFilePath(workspaceRoot), { force: true });
}
