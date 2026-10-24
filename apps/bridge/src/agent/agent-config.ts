import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The MCP server name the app's own scene tools are served under. */
export const HAI_SERVER = "hai";
/** The tool the agent calls to ask whether a tool call may run (Claude Code's --permission-prompt-tool). */
export const PERMISSION_TOOL = `mcp__${HAI_SERVER}__approve_tool`;

/**
 * What the agent is told on top of the user's own setup: the design context it works in. Short replies, because
 * they may be read on a HUD over the model.
 */
export const SYSTEM_PROMPT = `You are working in HAI, an architect's design environment, on a shared 3D scene.

- Scene lengths are millimetres. A "3 m" wall is 3000. Z is up; levels have an elevation in millimetres.
- Use the ${HAI_SERVER} tools for anything about the scene: get_scene_summary and get_elements to read it,
  create_elements, update_elements and delete_elements to change it, set_selection, and capture_view to see it.
  Everything you change in one request is a single step the user can undo.
- The user often points with their hand or selects elements instead of naming them. When they say "this", "that",
  "here" or "these", call get_user_context to see what is selected and what the hand is pointing at.
- The scene's own elements are massings, slabs, walls, columns and imported models. That is not all you can make.
  For curves, polylines, NURBS surfaces and smooth or organic forms (domes, vaults, canopies, minarets, anything
  round), never say it cannot be done and never fake it with many flat sides. If you have python_run, write the
  geometry in Python with rhino3dm, save it with hai_3dm as a .3dm in the project, and the user is offered Import
  into viewer; if Rhino is connected and you have rhino_run_python, model it there instead. Read the tool's
  description first: it lists exactly what can and cannot be built. Say what you made and that the file is offered.
- Keep replies short: they are read on a heads-up display over the model.
`;

/** Where an agent's files live in the project: `.hai/agent/<name>`, or `.hai/agent` for an unnamed session. */
export const agentDir = (projectDir: string, agent?: string) =>
  agent ? join(projectDir, ".hai", "agent", agent) : join(projectDir, ".hai", "agent");

export interface AgentConfigPaths {
  mcpConfigPath: string;
  systemPromptPath: string;
}

/**
 * Writes the agent's per-project files: an MCP config that adds only the app's scene server, with this agent's own
 * token (the user's own servers load as usual from their Claude Code setup), and the system prompt addition, with
 * `extraPrompt` appended (the lead's roster). `.hai` is kept out of git.
 */
export function writeAgentConfig(
  projectDir: string,
  mcp: { url: string; token: string },
  options: { agent?: string; extraPrompt?: string } = {},
): AgentConfigPaths {
  const dir = agentDir(projectDir, options.agent);
  mkdirSync(dir, { recursive: true });
  const haiDir = join(projectDir, ".hai");
  if (!existsSync(join(haiDir, ".gitignore"))) writeFileSync(join(haiDir, ".gitignore"), "*\n");
  const mcpConfigPath = join(dir, "mcp.json");
  const systemPromptPath = join(dir, "system.md");
  const config = {
    mcpServers: {
      [HAI_SERVER]: { type: "http", url: mcp.url, headers: { Authorization: `Bearer ${mcp.token}` } },
    },
  };
  writeFileSync(mcpConfigPath, `${JSON.stringify(config, null, 2)}\n`);
  writeFileSync(
    systemPromptPath,
    options.extraPrompt ? `${SYSTEM_PROMPT}\n${options.extraPrompt}\n` : SYSTEM_PROMPT,
  );
  return { mcpConfigPath, systemPromptPath };
}

/** What the lead is told about the specialists that can change the model, whose names fill the first words. */
export function builderCapabilities(names: string[]): string {
  return `${names.join(", ")} can do more than massings, walls, slabs and columns: they can model curves, polylines, NURBS surfaces and smooth or organic forms (domes, vaults, arches, canopies, minarets) by writing Python with rhino3dm (python_run), and when Rhino is connected they can model in Rhino. They save a .3dm and the user is offered Import into viewer. So never tell the user these things cannot be done, and never offer only a faceted look-alike: delegate it, and say in the instruction what to make and that python_run is the way.`;
}

/**
 * Which version of the instructions HAI gives every agent (the base prompt and what the lead is told about its
 * team's abilities). It changes whenever that text does.
 *
 * A saved conversation carries the version it was started under. Resuming one from an older version would keep
 * the agent to what it said before ("we can only make walls"), whatever the new instructions say, so such a
 * conversation is not resumed: the agent starts a new one. The old conversation stays in Claude Code's own history.
 */
export function instructionsVersion(): string {
  return createHash("sha1")
    .update(SYSTEM_PROMPT)
    .update("\n")
    .update(builderCapabilities(["x"]))
    .digest("hex")
    .slice(0, 12);
}

interface SessionRecord {
  sessionId: string;
  /** The `instructionsVersion()` the conversation was started under; absent in files written before it existed. */
  instructions?: string;
}

function readSessionRecord(projectDir: string, agent?: string): SessionRecord | undefined {
  try {
    const saved = JSON.parse(readFileSync(join(agentDir(projectDir, agent), "session.json"), "utf8"));
    if (typeof saved.sessionId !== "string" || !saved.sessionId) return undefined;
    return {
      sessionId: saved.sessionId,
      ...(typeof saved.instructions === "string" ? { instructions: saved.instructions } : {}),
    };
  } catch {
    return undefined;
  }
}

function writeSessionRecord(projectDir: string, record: SessionRecord, agent?: string): void {
  const dir = agentDir(projectDir, agent);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "session.json"), `${JSON.stringify(record, null, 2)}\n`);
}

/**
 * The agent's conversation to resume in this project: the one saved, if it was started under the instructions
 * HAI gives now. An older one is left alone and not resumed.
 */
export function readSessionId(projectDir: string, agent?: string): string | undefined {
  const record = readSessionRecord(projectDir, agent);
  return record?.instructions === instructionsVersion() ? record.sessionId : undefined;
}

/** Whether a conversation is saved for this agent but was started under older instructions, so it is not resumed. */
export function hasOutdatedSession(projectDir: string, agent?: string): boolean {
  return readSessionRecord(projectDir, agent) !== undefined && readSessionId(projectDir, agent) === undefined;
}

export function writeSessionId(projectDir: string, sessionId: string, agent?: string): void {
  writeSessionRecord(projectDir, { sessionId, instructions: instructionsVersion() }, agent);
}

/**
 * A project used before the team existed has one conversation (`.hai/agent/session.json`). It becomes the lead's,
 * so the user's earlier conversation continues with Mochi (if it is still resumable; the version it carries moves
 * with it).
 */
export function migrateSessionToLead(projectDir: string, lead: string): void {
  const old = readSessionRecord(projectDir);
  if (!old || readSessionRecord(projectDir, lead)) return;
  writeSessionRecord(projectDir, old, lead);
  rmSync(join(agentDir(projectDir), "session.json"), { force: true });
}
