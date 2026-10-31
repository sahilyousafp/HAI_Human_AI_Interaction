import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type AgentDefinitionInput, HAI_TOOLS, type TeamMemberInfo } from "@hai/protocol";
import { builderCapabilities, HAI_SERVER, type ManagedDefinition, splitGuidance } from "./agent-config.ts";
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
  /**
   * Groups of the app's read-only tools it has by role (names of `HAI_TOOLS` groups: the open-data tools of Urban,
   * the weather tools of Climate), whatever its definition file lists: existing projects keep the files they have.
   */
  grants: string[];
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

const SPECIALIST_CLOSE = `You receive tasks from Mochi, the team lead. Do the task with the hai tools, then end with a one or two sentence summary of
what you did and anything left open: it goes back to Mochi, who reports to the user. Lengths are millimetres, Z is up.
If you have offer_panel and open_panel: when the task involves values the user will want to feel out (a clearance, a tolerance, a count, a size, a colour, or a choice between design options), call offer_panel first, before you change the model, and if the user accepts, open_panel with sliders and buttons for those values, previewing with hai.preview and keeping the result with hai.commit. Do not hide such values in element properties, and do not offer a panel for a one-off edit.
If you have python_run (or rhino_run_python), curves, NURBS surfaces and smooth or organic forms are within your reach: write them in Python with rhino3dm, save a .3dm with hai_3dm, and say the user can import it. Never tell the user these cannot be made.`;

/** The team a project starts with. Files are written only where missing, so the user's edits always win. */
const DEFAULT_AGENTS: Record<string, DefaultAgent> = {
  mochi: {
    description:
      "The team lead. Takes every request, hands work to the specialists and reports what everyone is doing.",
    tools: [
      ...hai(HAI_TOOLS.team),
      ...hai(HAI_TOOLS.read),
      ...hai(HAI_TOOLS.view),
      ...hai(HAI_TOOLS.cameras),
    ],
    model: "sonnet",
    prompt: `You are Mochi, the lead of a small design team working on a shared 3D model in HAI.

- Hand work to the specialists with the delegate tool: one task per specialist, with a short title and a clear
  instruction that includes what the user pointed at or selected (get_user_context) and any sizes in millimetres.
  When a request names a specialist ("[for: architect]"), give it to that specialist.
- You do not change the model yourself. Answer questions about the model with the read tools, and when the user asks
  to see information (the team's status, a summary, a comparison), you may show it in a panel of your own: it is
  information only.
- When asked for status, call team_status and say who is doing what, in a sentence or two.
- When a "[team]" message reports finished work, tell the user what was done in one sentence.
- Your replies are read aloud: one or two short sentences, no lists, no recap of the steps. More only when asked.`,
    meta: {
      aliases: ["machi", "maci", "mochie", "mocha", "moochi"],
      color: "#d98fb6",
      writes: false,
      lead: true,
      grants: ["openData"],
    },
  },
  architect: {
    description:
      "Architecture: massing, levels, walls, slabs, columns and cores. Creates and edits building elements.",
    tools: [
      ...hai(HAI_TOOLS.read),
      ...hai(HAI_TOOLS.write),
      ...hai(HAI_TOOLS.geometry),
      ...hai(HAI_TOOLS.panel),
      ...hai(HAI_TOOLS.view),
      ...hai(HAI_TOOLS.cameras),
      ...hai(HAI_TOOLS.python),
      ...hai(HAI_TOOLS.rhino),
      ...hai(HAI_TOOLS.rhinoRead),
    ],
    model: "sonnet",
    prompt: `You are Architect, the team's architectural designer. You plan and model massing, levels, walls, slabs,
columns, cores and stairs with sensible proportions and clearances.\n\n${SPECIALIST_CLOSE}`,
    meta: { aliases: ["architects", "archie"], color: "#52bcc6", writes: true, lead: false, grants: [] },
  },
  product: {
    description: "Product design: furniture, fixtures and components at product scale.",
    tools: [
      ...hai(HAI_TOOLS.read),
      ...hai(HAI_TOOLS.write),
      ...hai(HAI_TOOLS.geometry),
      ...hai(HAI_TOOLS.panel),
      ...hai(HAI_TOOLS.view),
      ...hai(HAI_TOOLS.cameras),
      ...hai(HAI_TOOLS.python),
      ...hai(HAI_TOOLS.rhino),
      ...hai(HAI_TOOLS.rhinoRead),
    ],
    model: "sonnet",
    prompt: `You are Product, the team's product designer. You design furniture, fixtures and components at product
scale, with attention to ergonomics, materials and how they are made. Model simple shapes with the scene elements
(massing for blocks, columns for legs and posts) and anything curved or detailed with Python (python_run).\n\n${SPECIALIST_CLOSE}`,
    meta: { aliases: ["products", "producer"], color: "#e2ab4f", writes: true, lead: false, grants: [] },
  },
  climate: {
    description:
      "Climate: sun path, shadows, orientation and daylight studies, and the weather and climate of the site from open data (now, the forecast, normals).",
    tools: [
      ...hai(HAI_TOOLS.read),
      ...hai(HAI_TOOLS.climate),
      ...hai(HAI_TOOLS.openData),
      ...hai(HAI_TOOLS.weather),
      ...hai(HAI_TOOLS.view),
      ...hai(HAI_TOOLS.cameras),
      ...hai(HAI_TOOLS.python),
      ...hai(HAI_TOOLS.rhinoRead),
    ],
    model: "sonnet",
    prompt: `You are Climate, the team's environmental analyst. You study sun path, shadows, orientation and
daylight. Use sun_study for a date, time and location (ask Mochi if the location is unknown; London is 51.5, -0.1)
and describe what the shadows mean for the design. You do not change the model.

You can also read the weather and climate of the site from open data (weather_now, weather_forecast, climate_normals).
The project's site is used when you name no place; if it has none, ask the user where the project stands and propose it
with site_set (the user decides). Always say the source and how old the data is: every result carries its source,
licence, attribution, observation time and age in minutes. If open data is off you have no weather tools: say so and that
the user can switch it on in Settings > Open data; never state weather you did not read. Without data, keep to what you
can compute, such as the sun's position.\n\n${SPECIALIST_CLOSE}`,
    meta: {
      aliases: ["climates", "climat"],
      color: "#62c48f",
      writes: false,
      lead: false,
      grants: ["openData", "weather"],
    },
  },
  urban: {
    description:
      "Urban context: what open data says about the place around the project (neighbouring buildings and their heights, trees, vegetation cover, urban metrics, open-data portals). Reads, never changes the model.",
    tools: [
      ...hai(HAI_TOOLS.read),
      ...hai(HAI_TOOLS.view),
      ...hai(HAI_TOOLS.cameras),
      ...hai(HAI_TOOLS.context),
      ...hai(HAI_TOOLS.openData),
      ...hai(HAI_TOOLS.urban),
      ...hai(HAI_TOOLS.rhinoRead),
    ],
    model: "sonnet",
    prompt: `You are Urban, the team's urban analyst. You find out what the place around the project is like from open data: the
neighbouring buildings and their heights, the trees, the vegetation cover, simple urban metrics (building coverage,
mean and tallest height, green share, tree count) and what the open-data portals publish. You do not change the model.

- The project needs a site (open_data_sources says whether it has one). If it has none, ask Mochi or the user where the
  project stands and propose it with site_set: the user decides, and nothing is saved until they allow it.
- Fetch with urban_buildings and urban_vegetation: they fill the model's context layer, which the user and everyone's pictures
  show. Read it with context_list and context_get, and compute with urban_metrics. Search portals with open_data_search
  and read tables with open_data_get. When the user asks to clear, remove or delete the site context, empty the layer with
  context_clear (it never touches the model or the site, and says how much it removed).
- Always say where a number came from and how old it is: every result carries its source, licence, attribution, the
  time it was observed and its age. Say when a height is worked out (three metres a level) or a default, when an area is
  only partly covered, and that the land cover is a 2021 map and the greenness a scene from days or weeks ago.
- If open data is off you have no data tools: say so and that the user can switch it on in Settings > Open data. Never
  state numbers you did not read. A metric reported as missing means it was not fetched: fetch it, or say it is missing.
- When a table or a comparison is easier to see than to read, show it in an information panel (it only shows).
\n\n${SPECIALIST_CLOSE}`,
    meta: {
      aliases: ["urbanist", "planner", "urbans", "urbane"],
      color: "#d9774f",
      writes: false,
      lead: false,
      grants: ["openData", "urban"],
    },
  },
  simulation: {
    description:
      "Performance simulation: sun and shadow, the ground's surface temperature from open satellite data, and (when the user installed Ladybug Tools MCP) daylight and energy studies. Reports method, data and age, never a compliance verdict. Reads, never changes the model.",
    tools: [
      ...hai(HAI_TOOLS.read),
      ...hai(HAI_TOOLS.climate),
      ...hai(HAI_TOOLS.view),
      ...hai(HAI_TOOLS.cameras),
      ...hai(HAI_TOOLS.context),
      ...hai(HAI_TOOLS.openData),
      ...hai(HAI_TOOLS.weather),
      ...hai(HAI_TOOLS.simulation),
      ...hai(HAI_TOOLS.rhinoRead),
      "mcp__ladybug__*",
    ],
    model: "sonnet",
    prompt: `You are Simulation, the team's performance analyst. You study how the design behaves: sun and shadow
(sun_study), the temperature of the ground around it (surface_temperature), the weather of the site, and, when the
user has installed Ladybug Tools MCP (its tools start with mcp__ladybug__), daylight, energy and radiation studies
through it. You do not change the model.

- Get the model for a simulation with simulation_geometry (metres, +Z up, with what it simplified; include_context adds
  the neighbouring buildings as shading). The Ladybug server builds its own model: rebuild a simplified one from that
  description through its tools, say what you left out, and use weather for the site (weather_now, climate_normals, or
  the weather file its tools can fetch). Ask for the site with site_set if the project has none.
- If Ladybug Tools MCP is not installed, say so and how to add it (the Extensions tab, Ladybug Tools MCP, which shows
  its licence and the command to run), and offer what you can do without it: sun studies, shadows from the context
  layer, the ground temperature and the weather. Say plainly that these are not a daylight or energy simulation.
- surface_temperature is the temperature of the ground and roofs seen from a satellite (not the air) at the moment of a
  scene that is days to weeks old: say its date and age every time. If no scene qualifies you get no values: say so.
- Report method, data and age: the weather file or data and its age, the settings and the engine used, ranges where
  the method gives them, and what was not modelled. Never call a result compliant or certified.
- When a comparison or a table is easier to see than to read, show it in an information panel (it only shows).
\n\n${SPECIALIST_CLOSE}`,
    meta: {
      aliases: ["simulator", "sim", "ladybug", "simulations", "simulate"],
      color: "#c26ad6",
      writes: false,
      lead: false,
      grants: ["openData", "weather", "simulation"],
    },
  },
  reviewer: {
    description:
      "Checks the model against the brief and rules (heights, counts, clearances) and reports issues. Never edits.",
    tools: [
      ...hai(HAI_TOOLS.read),
      ...hai(HAI_TOOLS.view),
      ...hai(HAI_TOOLS.cameras),
      ...hai(HAI_TOOLS.rhinoRead),
    ],
    model: "sonnet",
    prompt: `You are Reviewer. You check the model against the brief and common rules (heights, counts, clearances,
overlaps) and report issues clearly with element names. You never change the model.\n\n${SPECIALIST_CLOSE}`,
    meta: {
      aliases: ["review or", "reviewers", "review"],
      color: "#8f9bff",
      writes: false,
      lead: false,
      grants: [],
    },
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
          grants: own.grants ?? defaults?.grants ?? [],
        },
      ];
    });
  return members.sort(byLeadThenName);
}

/** The `HAI_TOOLS` groups a role may grant: the ones that read or ask and change nothing. */
const GRANTABLE: ReadonlySet<string> = new Set(["openData", "urban", "weather", "simulation"]);

/** Whether an agent with these `hai` tools may change the model (no list means every tool, as for a single session). */
export function changesModel(tools: ReadonlySet<string> | null): boolean {
  return tools === null || HAI_TOOLS.write.some((t) => tools.has(t));
}

/**
 * The `hai` tools an agent may call, by their short names: those its definition lists, without the model-changing
 * ones unless it is marked as writing (the scheduler lets only one writing agent run at a time, so an agent it treats
 * as read-only must not write). Panel tools go to every agent whatever its definition lists, because HAI never
 * overwrites a definition the user edited and existing projects would otherwise never see them; the panel of an agent
 * that does not change the model is information only (the bridge marks it, the page enforces it). Whether the
 * Generated panels feature is on is decided when a tool is called.
 */
export function allowedHaiTools(member: TeamMember): Set<string> {
  const prefix = `mcp__${HAI_SERVER}__`;
  const writeTools: readonly string[] = member.writes
    ? []
    : [
        ...HAI_TOOLS.write,
        ...HAI_TOOLS.geometry,
        ...HAI_TOOLS.tags,
        ...HAI_TOOLS.rhino,
        ...HAI_TOOLS.workers,
        ...HAI_TOOLS.contextWrite,
      ];
  const tools = new Set(
    member.tools
      .filter((t) => t.startsWith(prefix))
      .map((t) => t.slice(prefix.length))
      .filter((t) => !writeTools.includes(t)),
  );
  // Starting a worker for a part of its own task is for the specialists that change the model.
  if (member.writes)
    for (const tool of [
      ...HAI_TOOLS.tags,
      ...HAI_TOOLS.geometry,
      ...HAI_TOOLS.python,
      ...HAI_TOOLS.rhino,
      ...HAI_TOOLS.workers,
      ...HAI_TOOLS.contextWrite,
    ])
      tools.add(tool);
  // The lead may show the user its plan before handing work out, whatever its file lists (older files do not).
  if (member.lead) for (const tool of HAI_TOOLS.team) tools.add(tool);
  // The read-only tools its role grants (open data, weather...): only groups that change nothing can be granted.
  for (const group of member.grants)
    if (GRANTABLE.has(group)) for (const tool of HAI_TOOLS[group as keyof typeof HAI_TOOLS]) tools.add(tool);
  // Looking around changes no element, so every agent may do it, whatever its definition lists. Claims are the same:
  // reading them is harmless, and asking for more only works for the agent's own running task. Panels are for every
  // agent: a reader's panel can only show.
  for (const tool of [
    ...HAI_TOOLS.view,
    ...HAI_TOOLS.cameras,
    ...HAI_TOOLS.claims,
    ...HAI_TOOLS.rhinoRead,
    ...HAI_TOOLS.panel,
    ...HAI_TOOLS.context,
    ...HAI_TOOLS.contextClear,
  ])
    tools.add(tool);
  return tools;
}

/**
 * The agent's definition as HAI runs it, for Claude Code's `--agents`. Claude Code hides every tool a definition's
 * `tools:` line does not list, and a project's file was written by whichever HAI created it (the user's own copy
 * lists whatever tools existed then, and never the panel tools), so the app's own tools are taken from
 * `allowedHaiTools` instead of the file. What the user listed that is not the app's (Read, Bash, their own MCP
 * servers), the prompt, the model and the description stay as in the file.
 */
export function managedDefinition(member: TeamMember): ManagedDefinition {
  const prefix = `mcp__${HAI_SERVER}__`;
  const others = member.tools.filter((t) => !t.startsWith(prefix) && !SUBAGENT_TOOLS.includes(t));
  const own = [...allowedHaiTools(member)].sort().map((t) => `${prefix}${t}`);
  return {
    description: member.description,
    prompt: member.prompt,
    // Every agent may start Claude Code's own subagents, for reading and reviewing (see `helperDefinitions`).
    tools: [...others, ...SUBAGENT_TOOLS, ...own],
    ...(member.model ? { model: member.model } : {}),
  };
}

/** Claude Code's tool for starting a subagent (named `Task` in older versions, `Agent` in newer ones). */
const SUBAGENT_TOOLS = ["Task", "Agent"];
/** What a helper may do outside the model: look at files. */
const FILE_TOOLS = ["Read", "Glob", "Grep"];

/**
 * The subagents an agent may start with Claude Code's own tool, as `--agents` entries. A subagent calls the app's tool
 * server with its parent's token, so the app cannot tell it from its parent: every one of them is read-only, whatever
 * a project's file for the same name says (a CLI definition wins over the file). There is one for each other member of
 * the team (named after it, with its way of looking at things, and only the tools that read the model and the view),
 * and two generic ones: `scout` (reads, and searches the web) and `checker` (reads). Changing the model with help goes
 * through a worker instead, which has its own identity.
 */
export function helperDefinitions(member: TeamMember, team: TeamMember[]): Record<string, ManagedDefinition> {
  const prefix = `mcp__${HAI_SERVER}__`;
  const looks = [...FILE_TOOLS, ...[...HAI_TOOLS.read, ...HAI_TOOLS.rhinoRead].map((t) => `${prefix}${t}`)];
  const note =
    "You are helping another agent. You only look and report back: you cannot change the model or run scripts.";
  const helpers: Record<string, ManagedDefinition> = {};
  for (const other of team) {
    if (other.name === member.name) continue;
    helpers[other.name] = {
      description: `${other.description} (as a read-only helper: it looks and reports, and changes nothing)`,
      prompt: `${other.prompt}\n\n${note}`,
      tools: looks,
      ...(other.model ? { model: other.model } : {}),
    };
  }
  helpers.scout = {
    description:
      "Looks things up for you: reads the model, the project's files and the web, and reports what it found. Changes nothing.",
    prompt: `You look things up and report briefly what you found, with where you found it. ${note}`,
    tools: [...looks, "WebSearch", "WebFetch"],
  };
  helpers.checker = {
    description:
      "Reads the model and checks a draft or a claim against it (sizes, overlaps, missing parts), and reports. Changes nothing.",
    prompt: `You check what you are asked to check against the model and report the problems you find, naming elements. ${note}`,
    tools: looks,
  };
  return helpers;
}

/** What a worker of this agent may not do: start workers, or hand tasks to other agents. */
const WORKER_REFUSED: ReadonlySet<string> = new Set(["spawn_worker", "delegate"]);

/** The `hai` tools of a worker started from this agent: the agent's own, without the means to start more work. */
export function workerHaiTools(member: TeamMember): Set<string> {
  return new Set([...allowedHaiTools(member)].filter((t) => !WORKER_REFUSED.has(t)));
}

/**
 * The definition a worker of this agent starts with (`--agents`): the agent's own, narrowed: a worker cannot start
 * workers or hand tasks to other agents. It has no file in `.claude/agents`, so it never appears in the Agents tab.
 */
export function workerDefinition(member: TeamMember): ManagedDefinition {
  const definition = managedDefinition(member);
  const prefix = `mcp__${HAI_SERVER}__`;
  return {
    ...definition,
    tools: definition.tools.filter(
      (t) => !(t.startsWith(prefix) && WORKER_REFUSED.has(t.slice(prefix.length))),
    ),
  };
}

/** An agent as the panel shows it (everything but its instructions). */
export function memberInfo(member: TeamMember): TeamMemberInfo {
  const { prompt: _prompt, grants: _grants, ...info } = member;
  return info;
}

/** The lead's roster of the others, for its instructions: who can do what. */
/** Which specialist a kind of request belongs to, for the specialists that are in the team. */
function routing(others: TeamMember[]): string {
  const has = (name: string) => others.some((m) => m.name === name);
  const lines = [
    has("urban") &&
      "- Where the project stands, the buildings and trees around it, vegetation cover, urban metrics and what open-data portals publish go to urban.",
    has("climate") && "- The weather now, forecasts, climate data, sun and shadow go to climate.",
    has("simulation") &&
      "- Surface (ground) temperature and building performance simulations (daylight, energy) go to simulation.",
  ].filter((line): line is string => typeof line === "string");
  return lines.length === 0 ? "" : `\n\nWho handles what:\n${lines.join("\n")}`;
}

export function rosterText(team: TeamMember[]): string {
  const others = team.filter((m) => !m.lead);
  if (others.length === 0) return "There are no specialists in this project yet.";
  const list = `Your team (use the name with delegate):\n${others.map((m) => `- ${m.name}: ${m.description}`).join("\n")}${routing(others)}`;
  const builders = others.filter((m) => m.writes).map((m) => m.name);
  if (builders.length === 0) return list;
  // What the specialists can do beyond the scene's own element types. The lead has no modelling tools, so without
  // this it only knows the descriptions above and tells the user that curves and smooth forms are impossible.
  return `${list}\n\n${builderCapabilities(builders)}\n\n${splitGuidance()}`;
}
