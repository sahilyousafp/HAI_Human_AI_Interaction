import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type AgentDefinitionInput, HAI_TOOLS, type TeamMemberInfo } from "@hai/protocol";
import { HAI_SERVER } from "./agent-config.ts";
import { listField, parseFrontmatter } from "./frontmatter.ts";

const hai = (names: readonly string[]) => names.map((n) => `mcp__${HAI_SERVER}__${n}`);

/** What HAI needs beyond Claude Code's definition: how the agent is named aloud, shown, and scheduled. */
export interface AgentMeta {
  /** Other ways the name is heard or typed (speech recognition mishears names). */
  aliases: string[];
  /** The agent's colour in the panel. */
  color: string;
  /** Whether it changes the model (only one such agent runs at a time). */
  writes: boolean;
  /** The lead: every request goes to it, and it hands work to the others. */
  lead: boolean;
}

/** An agent of the team: its Claude Code definition (`.claude/agents/<name>.md`) and HAI's metadata. */
export interface TeamMember extends AgentMeta {
  name: string;
  description: string;
  /** Allowed tools as Claude Code names them (`mcp__hai__create_elements`, `Read`, ...). */
  tools: string[];
  model?: string;
  /** The definition's instructions (its Markdown body). */
  prompt: string;
}

interface DefaultAgent {
  description: string;
  tools: string[];
  model: string;
  prompt: string;
  meta: AgentMeta;
}

const SPECIALIST_CLOSE = `You receive tasks from Mochi, the team lead. Do the task with the hai tools, then end with a short summary of
what you did and anything left open: it goes back to Mochi, who reports to the user. Lengths are millimetres, Z is up.
When the task says the user wants to tune, adjust or try values themselves (a clearance, a tolerance, a size), call offer_panel first and, if they accept, open_panel with sliders for those values; do not hide the values in element properties.`;

/** The team a project starts with. Files are written only where missing, so the user's edits always win. */
const DEFAULT_AGENTS: Record<string, DefaultAgent> = {
  mochi: {
    description:
      "The team lead. Takes every request, hands work to the specialists and reports what everyone is doing.",
    tools: [...hai(HAI_TOOLS.team), ...hai(HAI_TOOLS.read)],
    model: "sonnet",
    prompt: `You are Mochi, the lead of a small design team working on a shared 3D model in HAI.

- Hand work to the specialists with the delegate tool: one task per specialist, with a short title and a clear
  instruction that includes what the user pointed at or selected (get_user_context) and any sizes in millimetres.
  When a request names a specialist ("[for: architect]"), give it to that specialist.
- You do not change the model yourself. Answer questions about the model with the read tools.
- When asked for status, call team_status and say who is doing what, in a sentence or two.
- When a "[team]" message reports finished work, tell the user what was done, briefly.
- Your replies are read aloud: start with one short spoken sentence, then any detail.`,
    meta: {
      aliases: ["machi", "maci", "mochie", "mocha", "moochi"],
      color: "#d98fb6",
      writes: false,
      lead: true,
    },
  },
  architect: {
    description:
      "Architecture: massing, levels, walls, slabs, columns and cores. Creates and edits building elements.",
    tools: [
      ...hai(HAI_TOOLS.read),
      ...hai(HAI_TOOLS.write),
      ...hai(HAI_TOOLS.python),
      ...hai(HAI_TOOLS.rhino),
    ],
    model: "sonnet",
    prompt: `You are Architect, the team's architectural designer. You plan and model massing, levels, walls, slabs,
columns, cores and stairs with sensible proportions and clearances.\n\n${SPECIALIST_CLOSE}`,
    meta: { aliases: ["architects", "archie"], color: "#52bcc6", writes: true, lead: false },
  },
  product: {
    description: "Product design: furniture, fixtures and components at product scale.",
    tools: [
      ...hai(HAI_TOOLS.read),
      ...hai(HAI_TOOLS.write),
      ...hai(HAI_TOOLS.python),
      ...hai(HAI_TOOLS.rhino),
    ],
    model: "sonnet",
    prompt: `You are Product, the team's product designer. You design furniture, fixtures and components at product
scale, with attention to ergonomics, materials and how they are made. Model them with the scene elements you have
(massing for blocks, columns for legs and posts) until finer geometry tools arrive.\n\n${SPECIALIST_CLOSE}`,
    meta: { aliases: ["products", "producer"], color: "#e2ab4f", writes: true, lead: false },
  },
  climate: {
    description: "Environmental simulation: sun path, shadows, orientation and daylight studies.",
    tools: [
      ...hai(HAI_TOOLS.read),
      ...hai(HAI_TOOLS.climate),
      ...hai(HAI_TOOLS.python),
      ...hai(HAI_TOOLS.rhinoRead),
    ],
    model: "sonnet",
    prompt: `You are Climate, the team's environmental analyst. You study sun path, shadows, orientation and
daylight. Use sun_study for a date, time and location (ask Mochi if the location is unknown; London is 51.5, -0.1)
and describe what the shadows mean for the design. You do not change the model.\n\n${SPECIALIST_CLOSE}`,
    meta: { aliases: ["climates", "climat"], color: "#62c48f", writes: false, lead: false },
  },
  reviewer: {
    description:
      "Checks the model against the brief and rules (heights, counts, clearances) and reports issues. Never edits.",
    tools: [...hai(HAI_TOOLS.read), ...hai(HAI_TOOLS.rhinoRead)],
    model: "sonnet",
    prompt: `You are Reviewer. You check the model against the brief and common rules (heights, counts, clearances,
overlaps) and report issues clearly with element names. You never change the model.\n\n${SPECIALIST_CLOSE}`,
    meta: { aliases: ["review or", "reviewers", "review"], color: "#8f9bff", writes: false, lead: false },
  },
};

export const agentsDir = (projectDir: string) => join(projectDir, ".claude", "agents");
const metaFile = (projectDir: string) => join(projectDir, ".hai", "agents.json");

/** The team's order everywhere: the lead first, then the others by name. */
const byLeadThenName = (a: TeamMember, b: TeamMember) =>
  Number(b.lead) - Number(a.lead) || a.name.localeCompare(b.name);

/** A Claude Code agent definition file. The description is kept to one line, as front matter needs. */
function definitionFile(agent: {
  name: string;
  description: string;
  tools: readonly string[];
  model?: string | undefined;
  prompt: string;
}): string {
  const lines = [
    `name: ${agent.name}`,
    `description: ${agent.description.replace(/\s+/g, " ").trim()}`,
    ...(agent.tools.length ? [`tools: ${agent.tools.join(", ")}`] : []),
    ...(agent.model ? [`model: ${agent.model}`] : []),
  ];
  return `---\n${lines.join("\n")}\n---\n\n${agent.prompt.trim()}\n`;
}

/** The default team as it will be once written: shown (and its names heard) before the first request writes it. */
export function defaultRoster(): TeamMember[] {
  return Object.entries(DEFAULT_AGENTS)
    .map(([name, agent]) => ({
      name,
      description: agent.description,
      tools: [...agent.tools],
      model: agent.model,
      prompt: agent.prompt,
      ...agent.meta,
    }))
    .sort(byLeadThenName);
}

/** Writes the default agents the project does not define yet. Returns the names written. */
export function ensureDefaultAgents(projectDir: string): string[] {
  const dir = agentsDir(projectDir);
  mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  for (const [name, agent] of Object.entries(DEFAULT_AGENTS)) {
    const file = join(dir, `${name}.md`);
    if (existsSync(file)) continue;
    writeFileSync(file, definitionFile({ name, ...agent }));
    written.push(name);
  }
  return written;
}

function readMeta(projectDir: string): Record<string, Partial<AgentMeta>> {
  try {
    const data = JSON.parse(readFileSync(metaFile(projectDir), "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

/**
 * Adds or changes an agent from the Agents tab: its Claude Code definition and its HAI metadata. Whether it changes
 * the model follows from its tools; the lead stays the lead.
 */
export function saveDefinition(projectDir: string, agent: AgentDefinitionInput): void {
  mkdirSync(agentsDir(projectDir), { recursive: true });
  writeFileSync(join(agentsDir(projectDir), `${agent.name}.md`), definitionFile(agent));
  const writeTools = new Set(hai(HAI_TOOLS.write));
  const meta = readMeta(projectDir);
  meta[agent.name] = {
    ...meta[agent.name],
    aliases: agent.aliases,
    color: agent.color,
    writes: agent.tools.some((t) => writeTools.has(t)),
  };
  mkdirSync(join(projectDir, ".hai"), { recursive: true });
  writeFileSync(metaFile(projectDir), `${JSON.stringify(meta, null, 2)}\n`);
}

const FALLBACK_COLORS = ["#f0786d", "#c9a0f0", "#7fb3e6", "#d4c06a"];

/**
 * The project's team: every `.claude/agents/*.md` with a name and description, merged with HAI's metadata
 * (`.hai/agents.json` over the defaults). The lead comes first, then the others by name.
 */
export function readRoster(projectDir: string): TeamMember[] {
  const dir = agentsDir(projectDir);
  if (!existsSync(dir)) return [];
  const meta = readMeta(projectDir);
  const members = readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .flatMap((f, i): TeamMember[] => {
      const parsed = parseFrontmatter(readFileSync(join(dir, f), "utf8"));
      const name = parsed?.fields.name;
      if (!parsed || !name || !parsed.fields.description) return [];
      const defaults = DEFAULT_AGENTS[name]?.meta;
      const own = meta[name] ?? {};
      return [
        {
          name,
          description: parsed.fields.description,
          tools: listField(parsed.fields.tools),
          ...(parsed.fields.model ? { model: parsed.fields.model } : {}),
          prompt: parsed.body,
          aliases: own.aliases ?? defaults?.aliases ?? [],
          color: own.color ?? defaults?.color ?? (FALLBACK_COLORS[i % FALLBACK_COLORS.length] as string),
          writes: own.writes ?? defaults?.writes ?? true,
          lead: own.lead ?? defaults?.lead ?? false,
        },
      ];
    });
  return members.sort(byLeadThenName);
}

/**
 * The `hai` tools an agent may call, by their short names: those its definition lists, without the model-changing
 * ones unless it is marked as writing (the scheduler lets only one writing agent run at a time, so an agent it treats
 * as read-only must not write). Panel tools change the model through the user, so they go to every writing agent
 * whatever its definition lists: HAI never overwrites a definition the user edited, and existing projects would
 * otherwise never see them. Whether the Generated panels feature is on is decided when a tool is called.
 */
export function allowedHaiTools(member: TeamMember): Set<string> {
  const prefix = `mcp__${HAI_SERVER}__`;
  const writeTools: readonly string[] = member.writes
    ? []
    : [...HAI_TOOLS.write, ...HAI_TOOLS.panel, ...HAI_TOOLS.rhino];
  const tools = new Set(
    member.tools
      .filter((t) => t.startsWith(prefix))
      .map((t) => t.slice(prefix.length))
      .filter((t) => !writeTools.includes(t)),
  );
  if (member.writes)
    for (const tool of [...HAI_TOOLS.panel, ...HAI_TOOLS.python, ...HAI_TOOLS.rhino]) tools.add(tool);
  // Looking around changes no element, so every agent may do it, whatever its definition lists.
  for (const tool of [...HAI_TOOLS.view, ...HAI_TOOLS.rhinoRead]) tools.add(tool);
  return tools;
}

/** An agent as the panel shows it (everything but its instructions). */
export function memberInfo(member: TeamMember): TeamMemberInfo {
  const { prompt: _prompt, ...info } = member;
  return info;
}

/** The lead's roster of the others, for its instructions: who can do what. */
export function rosterText(team: TeamMember[]): string {
  const others = team.filter((m) => !m.lead);
  if (others.length === 0) return "There are no specialists in this project yet.";
  const list = `Your team (use the name with delegate):\n${others.map((m) => `- ${m.name}: ${m.description}`).join("\n")}`;
  const builders = others.filter((m) => m.writes).map((m) => m.name);
  if (builders.length === 0) return list;
  // What the specialists can do beyond the scene's own element types. The lead has no modelling tools, so without
  // this it only knows the descriptions above and tells the user that curves and smooth forms are impossible.
  return `${list}\n\n${builders.join(", ")} can do more than massings, walls, slabs and columns: they can model curves, polylines, NURBS surfaces and smooth or organic forms (domes, vaults, arches, canopies, minarets) by writing Python with rhino3dm (python_run), and when Rhino is connected they can model in Rhino. They save a .3dm and the user is offered Import into viewer. So never tell the user these things cannot be done, and never offer only a faceted look-alike: delegate it, and say in the instruction what to make and that python_run is the way.`;
}
