import { z } from "zod";

/** An MCP server as the agent session loaded it. */
export const AgentMcpServer = z.strictObject({
  name: z.string(),
  /** "connected", "failed", "pending", "needs-auth" or whatever the provider reports. */
  status: z.string(),
  /** Where it is configured: Claude Code's user, project or local scope, a plugin, claude.ai, or this session. */
  scope: z.enum(["user", "project", "local", "plugin", "claude.ai", "session", "unknown"]).default("unknown"),
  error: z.string().optional(),
});
export type AgentMcpServer = z.infer<typeof AgentMcpServer>;

export const AgentSkill = z.strictObject({
  name: z.string(),
  description: z.string().optional(),
  scope: z.enum(["user", "project", "plugin", "unknown"]).default("unknown"),
});
export type AgentSkill = z.infer<typeof AgentSkill>;

/**
 * What an agent session reports, independent of the provider (Claude Code today, Codex or a local model later).
 * The web only ever sees these, never a provider's raw output.
 */
export const AgentEvent = z.discriminatedUnion("type", [
  /** The session started: what it loaded. */
  z.strictObject({
    type: z.literal("init"),
    sessionId: z.string(),
    model: z.string().optional(),
    version: z.string().optional(),
    tools: z.array(z.string()),
    mcpServers: z.array(AgentMcpServer),
    skills: z.array(AgentSkill),
  }),
  /** A piece of reply text, as it is written. */
  z.strictObject({ type: z.literal("text.delta"), text: z.string() }),
  /** The agent called a tool. `server` is the MCP server for MCP tools. */
  z.strictObject({
    type: z.literal("tool.start"),
    id: z.string(),
    name: z.string(),
    server: z.string().optional(),
    input: z.unknown(),
  }),
  /** A tool call finished. `summary` is a short, readable result or error. */
  z.strictObject({
    type: z.literal("tool.end"),
    id: z.string(),
    outcome: z.enum(["done", "failed", "denied"]),
    summary: z.string(),
  }),
  /** The turn finished. */
  z.strictObject({
    type: z.literal("turn.end"),
    reason: z.enum(["done", "stopped", "error"]),
    usage: z.strictObject({ inputTokens: z.number(), outputTokens: z.number() }).optional(),
    durationMs: z.number().optional(),
  }),
  z.strictObject({ type: z.literal("error"), message: z.string() }),
]);
export type AgentEvent = z.infer<typeof AgentEvent>;

/** Where the agent session stands, as the panel shows it. */
export const AgentStatus = z.discriminatedUnion("state", [
  /** No session is possible; `reason` says why and what to do (Claude Code missing, not logged in). */
  z.strictObject({ state: z.literal("unavailable"), reason: z.string(), fix: z.string().optional() }),
  z.strictObject({ state: z.literal("starting") }),
  z.strictObject({ state: z.literal("idle") }),
  z.strictObject({ state: z.literal("working") }),
  /** The agent process ended unexpectedly and is being resumed. */
  z.strictObject({ state: z.literal("recovering") }),
]);
export type AgentStatus = z.infer<typeof AgentStatus>;

/** What a request refers to: what the user pointed at or tapped while speaking (in order), the selection, the ground point. */
export const RequestContext = z.strictObject({
  references: z.array(z.strictObject({ id: z.string(), type: z.string(), name: z.string() })).max(50),
  selection: z.array(z.string()).max(500),
  /** Where the hand pointer met the ground when the user stopped speaking, millimetres. */
  groundPoint: z.tuple([z.number(), z.number(), z.number()]).nullable(),
});
export type RequestContext = z.infer<typeof RequestContext>;

/** One request and everything the agent did for it, kept by the bridge so a reloaded page can replay it. */
export const AgentTurn = z.strictObject({
  id: z.string(),
  request: z.string(),
  /** What a spoken request referred to. */
  context: RequestContext.optional(),
  events: z.array(AgentEvent),
  /** Set when this turn ran in a session resumed after a crash. */
  recovered: z.boolean().default(false),
  /** A specialist's turn for a task Mochi handed out (`taskId`), or Mochi's turn reporting finished tasks. */
  kind: z.enum(["request", "task", "digest"]).default("request"),
  taskId: z.string().optional(),
});
export type AgentTurn = z.infer<typeof AgentTurn>;

/** Where a task Mochi handed to a specialist stands. */
export const TaskStatus = z.enum(["queued", "running", "waiting", "done", "failed", "stopped"]);
export type TaskStatus = z.infer<typeof TaskStatus>;

/** A task on the team's board. Times are epoch ms. */
export const TeamTask = z.strictObject({
  id: z.string(),
  agent: z.string(),
  title: z.string(),
  instruction: z.string(),
  status: TaskStatus,
  createdAt: z.number(),
  startedAt: z.number().optional(),
  finishedAt: z.number().optional(),
  /** The latest tool call or reply line, while it runs. */
  lastActivity: z.string().optional(),
  /** The specialist's final reply, shortened. */
  summary: z.string().optional(),
  /** The specialist's turn that does the task (in that agent's transcript). */
  turnId: z.string().optional(),
  /** Mochi's turn that handed it out. */
  fromTurn: z.string().optional(),
});
export type TeamTask = z.infer<typeof TeamTask>;

/** An agent of the team, as the panel shows it. */
export const TeamMemberInfo = z.strictObject({
  name: z.string(),
  description: z.string(),
  model: z.string().optional(),
  tools: z.array(z.string()),
  aliases: z.array(z.string()),
  color: z.string(),
  writes: z.boolean(),
  lead: z.boolean(),
});
export type TeamMemberInfo = z.infer<typeof TeamMemberInfo>;

/** The app's own MCP server's tools (`mcp__hai__<name>`), grouped by what they let an agent do. */
export const HAI_TOOLS = {
  read: ["get_scene_summary", "get_elements", "get_user_context", "capture_view"],
  write: ["create_elements", "update_elements", "delete_elements", "set_selection"],
  /** Offering and showing a generated panel; granted to every agent that changes the model. */
  panel: ["offer_panel", "open_panel", "update_panel", "close_panel"],
  team: ["delegate", "team_status", "cancel_task"],
  climate: ["sun_study"],
  /** Moves the viewer's camera and nothing else, so every agent has it. */
  view: ["set_view"],
  /** Runs Python in the managed environment; granted to the agents that change the model, and to any agent whose file lists it. */
  python: ["python_run"],
  /** Runs Python inside the open Rhino document; granted to the agents that change the model. */
  rhino: ["rhino_run_python"],
  /** Reads the Rhino document without running code; every agent has it. */
  rhinoRead: ["rhino_get_document"],
} as const;

/** An agent's whole definition, for the Agents tab: what the panel shows plus its instructions. */
export const AgentDefinition = TeamMemberInfo.extend({ prompt: z.string() });
export type AgentDefinition = z.infer<typeof AgentDefinition>;

/**
 * An agent the user adds or edits in the Agents tab. It becomes `.claude/agents/<name>.md` (name, description,
 * tools, model and the instructions) and its entry in `.hai/agents.json` (aliases, colour).
 */
export const AgentDefinitionInput = z.strictObject({
  name: z
    .string()
    .regex(
      /^[a-z][a-z0-9-]{0,31}$/,
      "Use lower-case letters, digits and - (up to 32), starting with a letter",
    ),
  description: z.string().trim().min(1, "Say what the agent does").max(300),
  model: z.string().trim().max(64).optional(),
  /** Tools as Claude Code names them (`mcp__hai__create_elements`, `Read`, `Bash(git:*)`). */
  tools: z.array(z.string().regex(/^[^,\n]{1,200}$/)).max(64),
  aliases: z.array(z.string().trim().min(1).max(40)).max(10),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  prompt: z.string().trim().min(1, "Give the agent its instructions").max(20_000),
});
export type AgentDefinitionInput = z.infer<typeof AgentDefinitionInput>;

export const ApprovalOutcome = z.enum(["allowed", "denied", "timed-out"]);
export type ApprovalOutcome = z.infer<typeof ApprovalOutcome>;

/** A tool call waiting for the user's decision. */
export const ApprovalRequest = z.strictObject({
  id: z.string(),
  /** The tool as the agent named it, e.g. "Bash" or "mcp__github__create_issue". */
  tool: z.string(),
  /** Where the tool comes from: "Claude Code" for built-in tools, or the MCP server name. */
  source: z.string(),
  /** A readable summary of the input (for a shell command, the command). */
  summary: z.string(),
  input: z.unknown(),
  /** The tool call this decides (the `id` of its tool.start event), when the provider reports it. */
  toolUseId: z.string().optional(),
  /** The team agent asking, when the bridge runs a team. */
  agent: z.string().optional(),
  /** When it is denied automatically (epoch ms). */
  expiresAt: z.number(),
  /** The packages a Python run would install on the user's machine, shown on its card. */
  installs: z.array(z.string()).optional(),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequest>;

/** A name for an MCP server or skill: letters, digits, dashes and underscores. */
export const ExtensionName = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, "Use letters, digits, - and _ (up to 64)");

/** An MCP server the user adds to the open project (Claude Code's project scope, `.mcp.json`). */
export const McpServerSpec = z.discriminatedUnion("transport", [
  z.strictObject({
    transport: z.literal("stdio"),
    name: ExtensionName,
    command: z.string().min(1).max(1000),
    args: z.array(z.string().max(2000)).max(64).default([]),
    /** Environment variables; values are secrets (masked in the interface, never logged or sent back). */
    env: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string().max(4000)).default({}),
  }),
  z.strictObject({
    transport: z.literal("http"),
    name: ExtensionName,
    url: z.url({ protocol: /^https?$/ }),
    /** Request headers; values are secrets (masked in the interface, never logged or sent back). */
    headers: z.record(z.string().regex(/^[A-Za-z0-9-]{1,128}$/), z.string().max(4000)).default({}),
  }),
]);
export type McpServerSpec = z.infer<typeof McpServerSpec>;

/** A project MCP server as the interface shows it: secret values are never included, only their names. */
export const ProjectMcpServer = z.strictObject({
  name: z.string(),
  transport: z.string(),
  /** The command line or URL. */
  target: z.string(),
  envKeys: z.array(z.string()),
  headerKeys: z.array(z.string()),
});
export type ProjectMcpServer = z.infer<typeof ProjectMcpServer>;

/** Everything about the agent's extensions: what the session loaded and what the open project configures. */
export const ExtensionsState = z.strictObject({
  /** From the session's latest start; null until the agent has run in this bridge. */
  loaded: z.strictObject({ servers: z.array(AgentMcpServer), skills: z.array(AgentSkill) }).nullable(),
  projectServers: z.array(ProjectMcpServer),
  projectSkills: z.array(AgentSkill),
});
export type ExtensionsState = z.infer<typeof ExtensionsState>;
