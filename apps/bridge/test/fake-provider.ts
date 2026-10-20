import { spawn } from "node:child_process";
import { join } from "node:path";
import { type AgentProvider, ClaudeCliProvider, type Detection, run } from "@aex/agent-core";

const FAKE = join(import.meta.dirname, "fake-claude.mjs");
export const DETECTED: Detection = { ok: true, version: "2.1.303-fake", executable: "fake" };

/**
 * The real provider, running the fake CLI (test/fake-claude.mjs) instead of claude, for sessions and for
 * `claude mcp` commands; detection answers as given.
 */
export function fakeProvider(stateDir: string, detection: Detection = DETECTED): AgentProvider {
  const env = { ...process.env, FAKE_CLAUDE_STATE: stateDir };
  const cli = new ClaudeCliProvider({
    spawnProcess: (_exe, args, cwd) => spawn(process.execPath, [FAKE, ...args], { cwd, env }),
    run: (_command, args, options) => run(process.execPath, [FAKE, ...args], options),
  });
  return {
    id: cli.id,
    label: cli.label,
    detect: async () => detection,
    start: (options) => cli.start(options),
    extensions: cli.extensions,
  };
}
