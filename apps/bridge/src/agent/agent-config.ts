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
  create_elements, update_elements and delete_elements to change it, set_selection, and capture_view to see what the
  user sees. Everything you change in one request is a single step the user can undo.
- Check your work by looking at it: after you change the model, place cameras of your own (camera_set) or use a
  preset (camera_capture with iso, top, front, left or orbit-sheet) and look from more than one side. Your cameras
  are private and off-screen, so the user's view never moves and their selection is not in your pictures. Use
  capture_view only to see what the user is looking at, and set_view only when you are asked to show them something.
- The user often points with their hand or selects elements instead of naming them. When they say "this", "that",
  "here" or "these", call get_user_context to see what is selected and what the hand is pointing at.
- The scene's own elements are massings, slabs, walls, columns and imported models. That is not all you can make.
  For curves, polylines, NURBS surfaces and smooth or organic forms (domes, vaults, canopies, minarets, anything
  round), never say it cannot be done and never fake it with many flat sides. If you have python_run, write the
  geometry in Python with rhino3dm, save it with hai_3dm as a .3dm in the project, and the user is offered Import
  into viewer; if Rhino is connected and you have rhino_run_python, model it there instead. Read the tool's
  description first: it lists exactly what can and cannot be built. Say what you made and that the file is offered.
- Several agents may change the model at the same time, each in its own part. A task may begin with a "[scope]" line
  naming the part you may change and a "[brief]" line with decisions every part must follow (datum, grid, key
  dimensions, colours, style): follow the brief so the parts fit together, and stay inside the scope. A change outside
  it, or to an element another agent holds, is refused whole with the holder's name; do not look for a way round it.
  Call get_claims to see who holds what, request_claim to ask for more (element ids, a part or a region), and
  release_claim to give back what you no longer need. What you create is stamped with your name and part by the
  system; set_tags adds your own tags, but names starting with "hai." are the system's.
- If you have spawn_worker and your task has separate parts that can be made at the same time (a dome and its
  minarets; two floors), you may start a worker for each: it is another session of you with its own instruction (it
  does not see this conversation, so give sizes in millimetres, ids and what the parts must agree on) and a scope inside
  what your task holds, written "<your part>/<name>" when your claim is a part. You cannot change a part while its
  worker runs; do the rest yourself, and your task ends after the workers do, each reporting back to you. Do not use it
  for work that is one piece: every worker is a model session with its own cost.
- Keep replies short: they are read on a heads-up display over the model.
`;

/** Where an agent's files live in the project: `.hai/agent/<name>`, or `.hai/agent` for an unnamed session. */
export const agentDir = (projectDir: string, agent?: string) =>
  agent ? join(projectDir, ".hai", "agent", agent) : join(projectDir, ".hai", "agent");

export interface AgentConfigPaths {
  mcpConfigPath: string;
  systemPromptPath: string;
  /** The agent's definition as the app runs it; absent when the agent has none (the unnamed session). */
  agentsPath?: string;
}

/** The agent's definition in the form Claude Code's `--agents` takes. */
export interface ManagedDefinition {
  description: string;
  prompt: string;
  tools: string[];
  model?: string;
}

/**
 * Writes the agent's per-project files: an MCP config that adds only the app's scene server, with this agent's own
 * token (the user's own servers load as usual from their Claude Code setup), and the system prompt addition, with
 * `extraPrompt` appended (the lead's roster). `.hai` is kept out of git.
 */
export function writeAgentConfig(
  projectDir: string,
  mcp: { url: string; token: string },
  options: {
    agent?: string;
    extraPrompt?: string;
    definition?: ManagedDefinition;
    /** The read-only subagents the agent may start, by name; the agent's own entry wins over a helper of its name. */
    helpers?: Record<string, ManagedDefinition>;
  } = {},
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
  if (!options.agent || !options.definition) return { mcpConfigPath, systemPromptPath };
  const agentsPath = join(dir, "agents.json");
  writeFileSync(
    agentsPath,
    `${JSON.stringify({ ...options.helpers, [options.agent]: options.definition }, null, 2)}
`,
  );
  return { mcpConfigPath, systemPromptPath, agentsPath };
}

/** What the lead is told about the specialists that can change the model, whose names fill the first words. */
export function builderCapabilities(names: string[]): string {
  return `${names.join(", ")} can do more than massings, walls, slabs and columns: they can model curves, polylines, NURBS surfaces and smooth or organic forms (domes, vaults, arches, canopies, minarets) by writing Python with rhino3dm (python_run), and when Rhino is connected they can model in Rhino. They save a .3dm and the user is offered Import into viewer. So never tell the user these things cannot be done, and never offer only a faceted look-alike: delegate it, and say in the instruction what to make and that python_run is the way.`;
}

/** How the lead splits a request that spans separate parts of the model. */
export function splitGuidance(): string {
  return `Splitting work: when a request spans separate parts of the model (a dome and a garden; the ground floor and the roof), hand out one task per part with one delegate call each, every task with its own scope (a part name, element ids or a region) that does not overlap the others, and one brief for all of them: the datum, grid, key dimensions, colours and style the parts must agree on. Specialists whose scopes do not overlap work at the same time, each in its own undo step. A task with no scope takes the whole model and runs alone, and tasks whose scopes overlap take turns: never give two tasks the same part, and if delegate warns that a task overlaps another, say so briefly. When the split has three or more parts, or is a judgement the user may want to change, call confirm_plan first with the parts (agent, title, scope): the user removes what they do not want and confirms, and you hand out only the parts it returns; hand out small, obvious splits directly. Do not split work that is one coherent piece.`;
}

/**
 * Which version of the instructions HAI gives every agent (the base prompt and what the lead is told about its
 * team's abilities). It changes whenever that text does.
 *
 * A saved conversation carries the version it was started under. Resuming one from an older version would keep
 * the agent to what it said before ("we can only make walls"), whatever the new instructions say, so such a
 * conversation is not resumed: the agent starts a new one. The old conversation stays in Claude Code's own history.
 */
export function instructionsVersion(surface = ""): string {
  return createHash("sha1")
    .update(SYSTEM_PROMPT)
    .update("\n")
    .update(builderCapabilities(["x"]))
    .update("\n")
    .update(splitGuidance())
    .update("\n")
    .update(surface)
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
export function readSessionId(projectDir: string, agent?: string, surface = ""): string | undefined {
  const record = readSessionRecord(projectDir, agent);
  return record?.instructions === instructionsVersion(surface) ? record.sessionId : undefined;
}

/** Whether a conversation is saved for this agent but was started under older instructions, so it is not resumed. */
export function hasOutdatedSession(projectDir: string, agent?: string, surface = ""): boolean {
  return (
    readSessionRecord(projectDir, agent) !== undefined &&
    readSessionId(projectDir, agent, surface) === undefined
  );
}

export function writeSessionId(projectDir: string, sessionId: string, agent?: string, surface = ""): void {
  writeSessionRecord(projectDir, { sessionId, instructions: instructionsVersion(surface) }, agent);
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
