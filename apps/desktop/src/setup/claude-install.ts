import { claudeInstallFolder } from "@hai/agent-core";

// What the first-run screen shows and runs to install Claude Code. Taken from Anthropic's own installation pages
// (https://code.claude.com/docs/en/setup and https://code.claude.com/docs/en/troubleshoot-install), checked on
// 2026-10-23. When those pages change, change this file and nothing else; docs/desktop.md names it.

/** The page the screen links to when the install fails or the user prefers to do it by hand. */
export const CLAUDE_INSTRUCTIONS_URL = "https://code.claude.com/docs/en/setup";

/** The installer script Anthropic publishes for Windows PowerShell; it needs no administrator rights. */
export const CLAUDE_INSTALL_SOURCE = "https://claude.ai/install.ps1";

/** Shown to the user word for word before anything runs, and run as it is shown. */
export const CLAUDE_INSTALL_COMMAND = `irm ${CLAUDE_INSTALL_SOURCE} | iex`;

/**
 * Where the installer puts `claude.exe` for the current user. It does not add that folder to the PATH. Detection
 * (packages/agent-core) looks there too, from the same definition, so the screen and the session agree.
 */
export { claudeInstallFolder };

/** A thing Claude Code needs on this computer before it works. */
export interface Prerequisite {
  id: string;
  /** What the screen calls it. */
  label: string;
  /** Why it is needed, in a sentence. */
  why: string;
}

/**
 * Empty today: Git for Windows is optional (without it Claude Code runs shell commands through PowerShell), so the
 * install needs nothing else first. A prerequisite added here appears as a step on the first-run screen.
 */
export const CLAUDE_PREREQUISITES: readonly Prerequisite[] = [];
