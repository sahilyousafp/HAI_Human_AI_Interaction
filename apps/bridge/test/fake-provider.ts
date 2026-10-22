import { spawn } from "node:child_process";
import { join } from "node:path";
import { type AgentProvider, ClaudeCliProvider, type Detection, run } from "@hai/agent-core";

const FAKE = join(import.meta.dirname, "fake-claude.mjs");
export const DETECTED: Detection = { ok: true, version: "2.1.303-fake", executable: "fake" };

/**
 * The real provider, running the fake CLI (test/fake-claude.mjs) instead of claude, for sessions and for
 * `claude mcp` commands; detection answers as given. A class, like the real one, so code that copies a provider
 * the wrong way (spreading it loses its methods) fails in tests too.
 */
class FakeProvider extends ClaudeCliProvider {
  constructor(
    stateDir: string,
    private readonly detection: Detection,
  ) {
    const env = { ...process.env, FAKE_CLAUDE_STATE: stateDir };
    super({
      spawnProcess: (_exe, args, cwd) => spawn(process.execPath, [FAKE, ...args], { cwd, env }),
      run: (_command, args, options) => run(process.execPath, [FAKE, ...args], options),
    });
  }

  override async detect(): Promise<Detection> {
    return this.detection;
  }
}

export function fakeProvider(stateDir: string, detection: Detection = DETECTED): AgentProvider {
  return new FakeProvider(stateDir, detection);
}
