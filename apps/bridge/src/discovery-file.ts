import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** What a local program (the Rhino plugin) needs to connect to the running bridge. */
export interface DiscoveryInfo {
  port: number;
  token: string;
  pid: number;
  startedAt: string;
}

/**
 * Where the running bridge says where it is: `%LOCALAPPDATA%\HAI\bridge.json` (the user's own application data), or
 * the same under the home folder where there is no such variable. `HAI_DISCOVERY_FILE` names another file, so a
 * second bridge (the end-to-end tests') never overwrites yours.
 */
export function discoveryFilePath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.HAI_DISCOVERY_FILE) return env.HAI_DISCOVERY_FILE;
  const base = env.LOCALAPPDATA ?? join(homedir(), ".local", "share");
  return join(base, "HAI", "bridge.json");
}

/** Limits a file to the current user: an ACL with only them on Windows, mode 600 elsewhere. Returns a warning if it could not. */
function restrictToUser(path: string): string | null {
  if (process.platform !== "win32") return null; // writeFileSync already created it with mode 0o600
  const user =
    process.env.USERDOMAIN && process.env.USERNAME
      ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}`
      : process.env.USERNAME;
  if (!user) return "the user name is unknown, so the discovery file keeps the folder's permissions";
  try {
    execFileSync("icacls", [path, "/inheritance:r", "/grant:r", `${user}:(F)`], {
      stdio: "ignore",
      windowsHide: true,
    });
    return null;
  } catch {
    return "could not restrict the discovery file to the current user; it keeps the folder's permissions";
  }
}

/** Writes the discovery file for the current user only. Returns a warning when the restriction could not be applied. */
export function writeDiscoveryFile(path: string, info: DiscoveryInfo): { warning: string | null } {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(info, null, 2)}\n`, { mode: 0o600 });
  return { warning: restrictToUser(path) };
}

export function readDiscoveryFile(path: string): DiscoveryInfo | null {
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    return typeof data?.port === "number" && typeof data?.token === "string" ? (data as DiscoveryInfo) : null;
  } catch {
    return null;
  }
}

/** Removes the file, but only if it still names this bridge: a newer bridge's file is left alone. */
export function removeDiscoveryFile(path: string, own: { pid: number; token: string }): void {
  const current = readDiscoveryFile(path);
  if (current && (current.pid !== own.pid || current.token !== own.token)) return;
  rmSync(path, { force: true });
}
