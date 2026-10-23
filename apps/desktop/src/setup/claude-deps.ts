import { detectClaude, findClaude } from "@hai/agent-core";
import type { ClaudeSetupOptions } from "./claude.ts";
import { claudeInstallRunner } from "./install-runner.ts";
import { openSignInTerminal } from "./sign-in.ts";

/**
 * What the Claude Code setup does to the real computer: the shared checks, the installer, the sign-in window. The end-to-end
 * tests build the app with test/claude-deps-fake.ts in place of this file (see stageApp's `fakeClaude`), so they can play
 * the whole first run, from "not installed" to "signed in", without installing anything or signing in to anything.
 */
export const claudeDeps: Pick<
  ClaudeSetupOptions,
  "detect" | "runInstaller" | "findExecutable" | "openTerminal"
> = {
  detect: () => detectClaude(),
  runInstaller: claudeInstallRunner,
  findExecutable: () => findClaude(),
  openTerminal: (executable) => openSignInTerminal(executable),
};
