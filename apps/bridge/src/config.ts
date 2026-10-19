import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const LOOPBACK_HOST = "127.0.0.1";
export const DEFAULT_PORT = 4870;
export const DEFAULT_ALLOWED_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

export interface BridgeConfig {
  host: string;
  port: number;
  allowedOrigins: string[];
  workspaceRoot: string;
}

/** The bridge must never be reachable from another machine. */
export function assertLoopback(host: string): void {
  if (host !== LOOPBACK_HOST) {
    throw new Error(
      `Refusing to listen on "${host}". The bridge only listens on ${LOOPBACK_HOST} so no other machine can reach your agent.`,
    );
  }
}

/** Walk up from `start` to the folder that holds pnpm-workspace.yaml. */
export function findWorkspaceRoot(start: string): string {
  let dir = resolve(start);
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
  return dir;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): BridgeConfig {
  const host = env.AEX_HOST ?? LOOPBACK_HOST;
  assertLoopback(host);
  const port = env.AEX_PORT ? Number(env.AEX_PORT) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`AEX_PORT must be a port number, got "${env.AEX_PORT}".`);
  }
  const allowedOrigins = env.AEX_ALLOWED_ORIGINS
    ? env.AEX_ALLOWED_ORIGINS.split(",").map((o) => o.trim())
    : DEFAULT_ALLOWED_ORIGINS;
  return { host, port, allowedOrigins, workspaceRoot: findWorkspaceRoot(cwd) };
}
