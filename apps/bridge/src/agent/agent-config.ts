import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The MCP server name the app's own scene tools are served under. */
export const AEX_SERVER = "aex";
/** The tool the agent calls to ask whether a tool call may run (Claude Code's --permission-prompt-tool). */
export const PERMISSION_TOOL = `mcp__${AEX_SERVER}__approve_tool`;

/**
 * What the agent is told on top of the user's own setup: the design context it works in. Short replies, because
 * they may be read on a HUD over the model.
 */
export const SYSTEM_PROMPT = `You are working in AEX, an architect's design environment, on a shared 3D scene.

- Scene lengths are millimetres. A "3 m" wall is 3000. Z is up; levels have an elevation in millimetres.
- Use the ${AEX_SERVER} tools for anything about the scene: get_scene_summary and get_elements to read it,
  create_elements, update_elements and delete_elements to change it, set_selection, and capture_view to see it.
  Everything you change in one request is a single step the user can undo.
- The user often points with their hand or selects elements instead of naming them. When they say "this", "that",
  "here" or "these", call get_user_context to see what is selected and what the hand is pointing at.
- Keep replies short: they are read on a heads-up display over the model.
`;

/** Where an agent's files live in the project: `.aex/agent/<name>`, or `.aex/agent` for an unnamed session. */
export const agentDir = (projectDir: string, agent?: string) =>
  agent ? join(projectDir, ".aex", "agent", agent) : join(projectDir, ".aex", "agent");

export interface AgentConfigPaths {
  mcpConfigPath: string;
  systemPromptPath: string;
}

/**
 * Writes the agent's per-project files: an MCP config that adds only the app's scene server, with this agent's own
 * token (the user's own servers load as usual from their Claude Code setup), and the system prompt addition, with
 * `extraPrompt` appended (the lead's roster). `.aex` is kept out of git.
 */
export function writeAgentConfig(
  projectDir: string,
  mcp: { url: string; token: string },
  options: { agent?: string; extraPrompt?: string } = {},
): AgentConfigPaths {
  const dir = agentDir(projectDir, options.agent);
  mkdirSync(dir, { recursive: true });
  const aexDir = join(projectDir, ".aex");
  if (!existsSync(join(aexDir, ".gitignore"))) writeFileSync(join(aexDir, ".gitignore"), "*\n");
  const mcpConfigPath = join(dir, "mcp.json");
  const systemPromptPath = join(dir, "system.md");
  const config = {
    mcpServers: {
      [AEX_SERVER]: { type: "http", url: mcp.url, headers: { Authorization: `Bearer ${mcp.token}` } },
    },
  };
  writeFileSync(mcpConfigPath, `${JSON.stringify(config, null, 2)}\n`);
  writeFileSync(
    systemPromptPath,
    options.extraPrompt ? `${SYSTEM_PROMPT}\n${options.extraPrompt}\n` : SYSTEM_PROMPT,
  );
  return { mcpConfigPath, systemPromptPath };
}

/** The agent's conversation to resume in this project, if any. */
export function readSessionId(projectDir: string, agent?: string): string | undefined {
  try {
    const id = JSON.parse(readFileSync(join(agentDir(projectDir, agent), "session.json"), "utf8")).sessionId;
    return typeof id === "string" && id ? id : undefined;
  } catch {
    return undefined;
  }
}

export function writeSessionId(projectDir: string, sessionId: string, agent?: string): void {
  const dir = agentDir(projectDir, agent);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "session.json"), `${JSON.stringify({ sessionId }, null, 2)}\n`);
}

/**
 * A project used before the team existed has one conversation (`.aex/agent/session.json`). It becomes the lead's,
 * so the user's earlier conversation continues with Mochi.
 */
export function migrateSessionToLead(projectDir: string, lead: string): void {
  const old = readSessionId(projectDir);
  if (!old || readSessionId(projectDir, lead)) return;
  writeSessionId(projectDir, old, lead);
  rmSync(join(agentDir(projectDir), "session.json"), { force: true });
}
