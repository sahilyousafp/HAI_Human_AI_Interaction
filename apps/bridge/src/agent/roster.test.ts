import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT } from "./agent-config.ts";
import { parseFrontmatter } from "./frontmatter.ts";
import {
  agentsDir,
  allowedHaiTools,
  changesModel,
  ensureDefaultAgents,
  managedDefinition,
  readRoster,
  rosterText,
} from "./roster.ts";

const project = () => mkdtempSync(join(tmpdir(), "hai-roster-"));

describe("the team", () => {
  it("defaults created once: mochi on Sonnet and the specialists, as Claude Code agent files", () => {
    const dir = project();
    expect(ensureDefaultAgents(dir).sort()).toEqual([
      "architect",
      "climate",
      "mochi",
      "product",
      "reviewer",
      "simulation",
      "urban",
    ]);
    expect(ensureDefaultAgents(dir)).toEqual([]); // nothing to write the second time
    const team = readRoster(dir);
    expect(team.map((m) => m.name)).toEqual([
      "mochi",
      "architect",
      "climate",
      "product",
      "reviewer",
      "simulation",
      "urban",
    ]);
    const mochi = team[0];
    expect(mochi).toMatchObject({ lead: true, model: "sonnet", writes: false });
    expect(parseFrontmatter(readFileSync(join(agentsDir(dir), "mochi.md"), "utf8"))?.fields.model).toBe(
      "sonnet",
    );
  });

  it("user edits are kept: an edited definition is never overwritten", () => {
    const dir = project();
    ensureDefaultAgents(dir);
    const file = join(agentsDir(dir), "architect.md");
    const edited =
      "---\nname: architect\ndescription: Only cores and stairs.\ntools: Read\n---\n\nMy own prompt.\n";
    writeFileSync(file, edited);
    ensureDefaultAgents(dir);
    expect(readFileSync(file, "utf8")).toBe(edited);
    expect(readRoster(dir).find((m) => m.name === "architect")).toMatchObject({
      description: "Only cores and stairs.",
      tools: ["Read"],
      prompt: "My own prompt.",
    });
  });

  it("a new specialist is routable: a new file joins the team and the lead's roster", () => {
    const dir = project();
    ensureDefaultAgents(dir);
    writeFileSync(
      join(agentsDir(dir), "structure.md"),
      "---\nname: structure\ndescription: Structural sizing.\ntools: mcp__hai__get_elements\n---\n\nYou are Structure.\n",
    );
    const team = readRoster(dir);
    const structure = team.find((m) => m.name === "structure");
    expect(structure).toMatchObject({ writes: true, lead: false, aliases: [] });
    expect(rosterText(team)).toContain("- structure: Structural sizing.");
    expect(rosterText(team)).not.toContain("mochi");
  });

  it("the lead is told the writing specialists can model curves and smooth forms, so it never calls them impossible", () => {
    const dir = project();
    ensureDefaultAgents(dir);
    const team = readRoster(dir);
    const text = rosterText(team);
    for (const writer of team.filter((m) => m.writes && !m.lead)) expect(text).toContain(writer.name);
    expect(text).toMatch(/NURBS surfaces and smooth or organic forms/);
    expect(text).toContain("python_run");
    expect(text).toMatch(/never tell the user these things cannot be done/);
    // Without anyone who can model there is nothing to promise.
    expect(rosterText(team.filter((m) => !m.writes))).not.toContain("python_run");
  });

  it("the lead is told to split a request into non-overlapping scopes with one brief", () => {
    const dir = project();
    ensureDefaultAgents(dir);
    const team = readRoster(dir);
    const text = rosterText(team);
    expect(text).toMatch(/one task per part/);
    expect(text).toMatch(/scope .* that does not overlap/);
    expect(text).toMatch(/one brief for all of them/);
    expect(text).toMatch(/never give two tasks the same part/);
    expect(rosterText(team.filter((m) => !m.writes))).not.toContain("Splitting work");
  });

  it("every agent's base instructions explain the scope, the brief and the claim tools", () => {
    expect(SYSTEM_PROMPT).toContain("[scope]");
    expect(SYSTEM_PROMPT).toContain("[brief]");
    for (const tool of ["get_claims", "request_claim", "release_claim", "set_tags"])
      expect(SYSTEM_PROMPT).toContain(tool);
  });

  describe("the definition the agent is run with", () => {
    const OLD_TOOLS = [
      "get_scene_summary",
      "get_elements",
      "get_user_context",
      "capture_view",
      "create_elements",
      "update_elements",
      "delete_elements",
      "set_selection",
    ]
      .map((t) => `mcp__hai__${t}`)
      .join(", ");
    /** A project's agent file as HAI wrote it before Python, the view and the panels existed. */
    const file = (name: string, tools: string, body = "You are Architect.") =>
      `---\nname: ${name}\ndescription: Architecture.\ntools: ${tools}\nmodel: sonnet\n---\n\n${body}\n`;
    const names = (dir: string, agent: string) => {
      const member = readRoster(dir).find((m) => m.name === agent);
      if (!member) throw new Error(`no ${agent}`);
      return managedDefinition(member).tools;
    };

    it("an old file that lists only eight tools still gives the model Python, panels and the view", () => {
      const dir = project();
      ensureDefaultAgents(dir);
      writeFileSync(join(agentsDir(dir), "architect.md"), file("architect", OLD_TOOLS));
      const tools = names(dir, "architect");
      for (const wanted of [
        "python_run",
        "rhino_run_python",
        "offer_panel",
        "open_panel",
        "set_view",
        "create_elements",
      ])
        expect(tools).toContain(`mcp__hai__${wanted}`);
    });

    it("the prompt, model and description stay as the file has them", () => {
      const dir = project();
      ensureDefaultAgents(dir);
      writeFileSync(join(agentsDir(dir), "architect.md"), file("architect", OLD_TOOLS));
      const member = readRoster(dir).find((m) => m.name === "architect");
      if (!member) throw new Error("no architect");
      expect(managedDefinition(member)).toMatchObject({
        description: "Architecture.",
        prompt: "You are Architect.",
        model: "sonnet",
      });
    });

    it("what the user listed that is not HAI's is kept", () => {
      const dir = project();
      ensureDefaultAgents(dir);
      writeFileSync(
        join(agentsDir(dir), "architect.md"),
        file("architect", "Read, Bash, mcp__github__create_issue, mcp__hai__get_elements"),
      );
      expect(names(dir, "architect").slice(0, 3)).toEqual(["Read", "Bash", "mcp__github__create_issue"]);
    });

    it("Reviewer and Climate never get the tools that change the model, whatever their files list", () => {
      const dir = project();
      ensureDefaultAgents(dir);
      writeFileSync(
        join(agentsDir(dir), "reviewer.md"),
        file("reviewer", "mcp__hai__create_elements, mcp__hai__offer_panel, mcp__hai__get_elements"),
      );
      const reviewer = names(dir, "reviewer");
      for (const banned of ["create_elements", "rhino_run_python", "python_run"])
        expect(reviewer).not.toContain(`mcp__hai__${banned}`);
      expect(reviewer).toContain("mcp__hai__get_elements");
      // Panels are for every agent: a reader's panel is information only.
      expect(reviewer).toContain("mcp__hai__offer_panel");
      expect(names(dir, "climate")).toContain("mcp__hai__python_run");
      expect(names(dir, "climate")).not.toContain("mcp__hai__create_elements");
    });

    it("Mochi keeps its team tools and gets no modelling tools", () => {
      const dir = project();
      ensureDefaultAgents(dir);
      const tools = names(dir, "mochi");
      expect(tools).toContain("mcp__hai__delegate");
      expect(tools).not.toContain("mcp__hai__create_elements");
      expect(tools).not.toContain("mcp__hai__python_run");
    });

    it("the new defaults list every tool the role has, so the Agents tab shows them", () => {
      const dir = project();
      ensureDefaultAgents(dir);
      const architect = readRoster(dir).find((m) => m.name === "architect");
      for (const wanted of ["offer_panel", "open_panel", "set_view", "python_run", "rhino_get_document"])
        expect(architect?.tools).toContain(`mcp__hai__${wanted}`);
    });
  });

  it("each agent's hai tools come from its definition; Reviewer only reads", () => {
    const dir = project();
    ensureDefaultAgents(dir);
    const team = readRoster(dir);
    const tools = (name: string) => {
      const member = team.find((m) => m.name === name);
      if (!member) throw new Error(`no ${name}`);
      return allowedHaiTools(member);
    };
    expect([...tools("reviewer")].sort()).toEqual([
      "camera_capture",
      "camera_delete",
      "camera_list",
      "camera_set",
      "capture_view",
      "close_panel",
      "context_clear",
      "context_get",
      "context_list",
      "get_claims",
      "get_elements",
      "get_scene_summary",
      "get_user_context",
      "offer_panel",
      "open_panel",
      "release_claim",
      "request_claim",
      "rhino_get_document",
      "set_view",
      "update_panel",
    ]);
    expect(tools("architect").has("create_elements")).toBe(true);
    expect(tools("mochi").has("delegate")).toBe(true);
    expect(tools("mochi").has("create_elements")).toBe(false);
    expect(tools("climate").has("sun_study")).toBe(true);
  });

  it("an agent not marked as writing gets no model-changing tools, whatever its definition lists", () => {
    const dir = project();
    ensureDefaultAgents(dir);
    writeFileSync(
      join(agentsDir(dir), "climate.md"),
      "---\nname: climate\ndescription: Sun.\ntools: mcp__hai__get_elements, mcp__hai__create_elements\n---\n\nSun.\n",
    );
    const climate = readRoster(dir).find((m) => m.name === "climate");
    if (!climate) throw new Error("no climate");
    expect([...allowedHaiTools(climate)].sort()).toEqual([
      "camera_capture",
      "camera_delete",
      "camera_list",
      "camera_set",
      "climate_normals",
      "close_panel",
      "context_clear",
      "context_get",
      "context_list",
      "get_claims",
      "get_elements",
      "offer_panel",
      "open_data_sources",
      "open_panel",
      "release_claim",
      "request_claim",
      "rhino_get_document",
      "set_view",
      "site_set",
      "update_panel",
      "weather_forecast",
      "weather_now",
    ]);
    expect([...allowedHaiTools({ ...climate, writes: true })].sort()).toEqual([
      "camera_capture",
      "camera_delete",
      "camera_list",
      "camera_set",
      "climate_normals",
      "close_panel",
      "context_adopt",
      "context_clear",
      "context_get",
      "context_list",
      "create_elements",
      "geometry_array_along_curve",
      "geometry_boolean",
      "geometry_loft",
      "geometry_offset",
      "geometry_sweep",
      "get_claims",
      "get_elements",
      "offer_panel",
      "open_data_sources",
      "open_panel",
      "python_run",
      "release_claim",
      "request_claim",
      "rhino_get_document",
      "rhino_run_python",
      "set_tags",
      "set_view",
      "site_set",
      "spawn_worker",
      "update_panel",
      "weather_forecast",
      "weather_now",
    ]);
  });

  it("every agent has set_view, Reviewer and Mochi included: it moves the camera and changes no element", () => {
    const dir = project();
    ensureDefaultAgents(dir);
    for (const member of readRoster(dir))
      expect(allowedHaiTools(member).has("set_view"), member.name).toBe(true);
    // Even an agent whose definition lists no hai tool at all.
    writeFileSync(
      join(agentsDir(dir), "reviewer.md"),
      "---\nname: reviewer\ndescription: Checks.\ntools: Read\n---\n\nYou review.\n",
    );
    const reviewer = readRoster(dir).find((m) => m.name === "reviewer");
    expect([...allowedHaiTools(reviewer as never)].sort()).toEqual([
      "camera_capture",
      "camera_delete",
      "camera_list",
      "camera_set",
      "close_panel",
      "context_clear",
      "context_get",
      "context_list",
      "get_claims",
      "offer_panel",
      "open_panel",
      "release_claim",
      "request_claim",
      "rhino_get_document",
      "set_view",
      "update_panel",
    ]);
  });

  describe("Python and Rhino tools", () => {
    const toolsOf = (dir: string, name: string) => {
      const member = readRoster(dir).find((m) => m.name === name);
      if (!member) throw new Error(`no ${name}`);
      return allowedHaiTools(member);
    };

    it("Roles get their tools: Architect and Product run Python both ways, Climate the workbench, Reviewer only reads", () => {
      const dir = project();
      ensureDefaultAgents(dir);
      for (const name of ["architect", "product"]) {
        const tools = toolsOf(dir, name);
        for (const tool of ["python_run", "rhino_run_python", "rhino_get_document"])
          expect(tools.has(tool), `${name} ${tool}`).toBe(true);
      }
      const climate = toolsOf(dir, "climate");
      expect(climate.has("python_run")).toBe(true);
      expect(climate.has("rhino_get_document")).toBe(true);
      expect(climate.has("rhino_run_python")).toBe(false);
      const reviewer = toolsOf(dir, "reviewer");
      expect(reviewer.has("rhino_get_document")).toBe(true);
      expect(reviewer.has("python_run")).toBe(false);
      expect(reviewer.has("rhino_run_python")).toBe(false);
      expect(toolsOf(dir, "mochi").has("python_run")).toBe(false);
    });

    it("an existing project's unchanged Architect file still gets them", () => {
      const dir = project();
      mkdirSync(agentsDir(dir), { recursive: true });
      writeFileSync(
        join(agentsDir(dir), "architect.md"),
        "---\nname: architect\ndescription: Architecture.\ntools: mcp__hai__get_elements\n---\n\nYou are Architect.\n",
      );
      const tools = toolsOf(dir, "architect");
      expect(tools.has("python_run")).toBe(true);
      expect(tools.has("rhino_run_python")).toBe(true);
    });

    it("Reviewer cannot run Python even if its file lists the tools", () => {
      const dir = project();
      ensureDefaultAgents(dir);
      writeFileSync(
        join(agentsDir(dir), "reviewer.md"),
        "---\nname: reviewer\ndescription: Checks.\ntools: mcp__hai__rhino_run_python\n---\n\nYou review.\n",
      );
      expect(toolsOf(dir, "reviewer").has("rhino_run_python")).toBe(false);
    });
  });

  describe("panel tools", () => {
    const PANEL = ["close_panel", "offer_panel", "open_panel", "update_panel"];
    const toolsOf = (dir: string, name: string) => {
      const member = readRoster(dir).find((m) => m.name === name);
      if (!member) throw new Error(`no ${name}`);
      return [...allowedHaiTools(member)];
    };

    it("every writing agent gets them, whatever its definition lists", () => {
      const dir = project();
      ensureDefaultAgents(dir);
      for (const name of ["architect", "product"]) {
        expect(toolsOf(dir, name)).toEqual(expect.arrayContaining(PANEL));
      }
    });

    it("an existing project's unchanged Architect file still gets them", () => {
      const dir = project();
      mkdirSync(agentsDir(dir), { recursive: true });
      // The file as an earlier version wrote it: no panel tools in its list.
      writeFileSync(
        join(agentsDir(dir), "architect.md"),
        "---\nname: architect\ndescription: Architecture.\ntools: mcp__hai__get_elements, mcp__hai__create_elements, mcp__hai__update_elements\n---\n\nYou are Architect.\n",
      );
      expect(toolsOf(dir, "architect")).toEqual(expect.arrayContaining(PANEL));
    });

    it("every agent gets them, Reviewer, Mochi and Climate included (theirs are information panels)", () => {
      const dir = project();
      ensureDefaultAgents(dir);
      for (const name of ["reviewer", "mochi", "climate"]) {
        expect(toolsOf(dir, name)).toEqual(expect.arrayContaining(PANEL));
      }
    });

    it("an agent that is not a writer gets them even if its definition lists none, and still no model-changing tool", () => {
      const dir = project();
      ensureDefaultAgents(dir);
      writeFileSync(
        join(agentsDir(dir), "reviewer.md"),
        "---\nname: reviewer\ndescription: Checks.\ntools: mcp__hai__get_elements, mcp__hai__create_elements\n---\n\nYou review.\n",
      );
      const tools = toolsOf(dir, "reviewer");
      expect(tools).toEqual(expect.arrayContaining(PANEL));
      expect(tools).not.toContain("create_elements");
    });

    it("a panel is information only exactly for an agent that cannot change the model", () => {
      const dir = project();
      ensureDefaultAgents(dir);
      const may = (name: string) => {
        const member = readRoster(dir).find((m) => m.name === name);
        if (!member) throw new Error(`no ${name}`);
        return changesModel(allowedHaiTools(member));
      };
      expect(may("architect")).toBe(true);
      for (const name of ["mochi", "climate", "reviewer"]) expect(may(name)).toBe(false);
      expect(changesModel(null)).toBe(true);
    });
  });

  it("HAI metadata in .hai/agents.json overrides the defaults", () => {
    const dir = project();
    ensureDefaultAgents(dir);
    mkdirSync(join(dir, ".hai"), { recursive: true });
    writeFileSync(
      join(dir, ".hai", "agents.json"),
      JSON.stringify({ climate: { aliases: ["sunny"], writes: true } }),
    );
    expect(readRoster(dir).find((m) => m.name === "climate")).toMatchObject({
      aliases: ["sunny"],
      writes: true,
    });
  });

  it("files without a name or description are not agents", () => {
    const dir = project();
    mkdirSync(agentsDir(dir), { recursive: true });
    writeFileSync(join(agentsDir(dir), "notes.md"), "Just notes.\n");
    writeFileSync(join(agentsDir(dir), "half.md"), "---\nname: half\n---\n");
    expect(readRoster(dir)).toEqual([]);
    expect(readdirSync(agentsDir(dir))).toHaveLength(2);
  });
});

describe("Urban", () => {
  const toolsOf = (dir: string, name: string) => {
    const member = readRoster(dir).find((m) => m.name === name);
    if (!member) throw new Error(`no ${name}`);
    return allowedHaiTools(member);
  };
  const URBAN = ["open_data_search", "open_data_get", "urban_buildings", "urban_vegetation", "urban_metrics"];

  it("is in the default team, reads only, with its own colour, speech names and the urban tools", () => {
    const dir = project();
    ensureDefaultAgents(dir);
    const urban = readRoster(dir).find((m) => m.name === "urban");
    expect(urban).toMatchObject({ writes: false, lead: false });
    expect(urban?.aliases).toEqual(expect.arrayContaining(["urbanist", "planner"]));
    const tools = toolsOf(dir, "urban");
    for (const tool of [
      ...URBAN,
      "open_data_sources",
      "site_set",
      "context_list",
      "context_get",
      "offer_panel",
    ])
      expect(tools.has(tool), tool).toBe(true);
    for (const tool of ["create_elements", "update_elements", "context_adopt", "python_run", "spawn_worker"])
      expect(tools.has(tool), tool).toBe(false);
  });

  it("cannot change the model, whatever its file lists", () => {
    const dir = project();
    ensureDefaultAgents(dir);
    writeFileSync(
      join(agentsDir(dir), "urban.md"),
      "---\nname: urban\ndescription: Urban.\ntools: mcp__hai__create_elements, mcp__hai__context_adopt, mcp__hai__urban_buildings\n---\n\nUrban.\n",
    );
    const tools = toolsOf(dir, "urban");
    expect(tools.has("create_elements")).toBe(false);
    expect(tools.has("context_adopt")).toBe(false);
    // The role's own tools come from the role, not from an older file that never listed them.
    expect(tools.has("urban_metrics")).toBe(true);
  });

  it("a project with the earlier five agents gains Urban only, and edits are kept", () => {
    const dir = project();
    ensureDefaultAgents(dir);
    rmSync(join(agentsDir(dir), "urban.md"));
    const edited = "---\nname: architect\ndescription: Mine.\ntools: Read\n---\n\nMine.\n";
    writeFileSync(join(agentsDir(dir), "architect.md"), edited);
    expect(ensureDefaultAgents(dir)).toEqual(["urban"]);
    expect(readFileSync(join(agentsDir(dir), "architect.md"), "utf8")).toBe(edited);
  });

  it("the urban tools are Urban's alone: Mochi has the open-data pair, Reviewer and the writers have none", () => {
    const dir = project();
    ensureDefaultAgents(dir);
    for (const name of ["mochi", "reviewer", "architect", "product", "climate"])
      for (const tool of URBAN) expect(toolsOf(dir, name).has(tool), `${name} ${tool}`).toBe(false);
    expect(toolsOf(dir, "mochi").has("open_data_sources")).toBe(true);
    expect(toolsOf(dir, "reviewer").has("open_data_sources")).toBe(false);
  });

  it("every default agent has its own colour, clearly apart from the others", () => {
    const dir = project();
    ensureDefaultAgents(dir);
    const rgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
    const team = readRoster(dir);
    for (const a of team)
      for (const b of team) {
        if (a.name >= b.name) continue;
        const [r1, g1, b1] = rgb(a.color) as number[];
        const [r2, g2, b2] = rgb(b.color) as number[];
        const distance = Math.hypot(
          (r1 as number) - (r2 as number),
          (g1 as number) - (g2 as number),
          (b1 as number) - (b2 as number),
        );
        expect(distance, `${a.name} and ${b.name}`).toBeGreaterThan(50);
      }
  });

  it("Mochi is told who handles what, with the specialists that are on the team", () => {
    const dir = project();
    ensureDefaultAgents(dir);
    const text = rosterText(readRoster(dir));
    expect(text).toContain("Who handles what");
    expect(text).toContain("go to urban");
    expect(text).toContain("go to climate");
    expect(text).toContain("go to simulation");
  });
});

describe("Climate with live data", () => {
  const toolsOf = (dir: string, name: string) => {
    const member = readRoster(dir).find((m) => m.name === name);
    if (!member) throw new Error(`no ${name}`);
    return allowedHaiTools(member);
  };

  it("has the weather tools and the open-data pair, keeps sun_study, and still cannot change the model", () => {
    const dir = project();
    ensureDefaultAgents(dir);
    const tools = toolsOf(dir, "climate");
    for (const tool of [
      "weather_now",
      "weather_forecast",
      "climate_normals",
      "open_data_sources",
      "site_set",
      "sun_study",
    ])
      expect(tools.has(tool), tool).toBe(true);
    for (const tool of ["create_elements", "context_adopt", "urban_buildings"])
      expect(tools.has(tool), tool).toBe(false);
  });

  it("an existing project's Climate file, written before the weather tools, still gets them (the role grants them)", () => {
    const dir = project();
    ensureDefaultAgents(dir);
    writeFileSync(
      join(agentsDir(dir), "climate.md"),
      "---\nname: climate\ndescription: Sun.\ntools: mcp__hai__get_elements, mcp__hai__sun_study\n---\n\nSun.\n",
    );
    const tools = toolsOf(dir, "climate");
    expect(tools.has("weather_now")).toBe(true);
    expect(tools.has("sun_study")).toBe(true);
  });

  it("the weather tools are Climate's: Mochi, Reviewer and Urban have none", () => {
    const dir = project();
    ensureDefaultAgents(dir);
    for (const name of ["mochi", "reviewer", "urban", "architect"])
      for (const tool of ["weather_now", "weather_forecast", "climate_normals"])
        expect(toolsOf(dir, name).has(tool), `${name} ${tool}`).toBe(false);
  });
});

describe("Simulation", () => {
  const member = (dir: string) => {
    const found = readRoster(dir).find((m) => m.name === "simulation");
    if (!found) throw new Error("no simulation");
    return found;
  };

  it("is in the default team, reads only, with its own speech names", () => {
    const dir = project();
    ensureDefaultAgents(dir);
    const simulation = member(dir);
    expect(simulation).toMatchObject({ writes: false, lead: false });
    expect(simulation.aliases).toEqual(expect.arrayContaining(["simulator", "sim", "ladybug"]));
  });

  it("has the simulation, weather and open-data tools and still cannot change the model", () => {
    const dir = project();
    ensureDefaultAgents(dir);
    const tools = allowedHaiTools(member(dir));
    for (const tool of [
      "surface_temperature",
      "simulation_geometry",
      "weather_now",
      "climate_normals",
      "open_data_sources",
      "site_set",
      "sun_study",
      "context_get",
      "offer_panel",
    ])
      expect(tools.has(tool), tool).toBe(true);
    for (const tool of ["create_elements", "context_adopt", "urban_buildings", "python_run", "spawn_worker"])
      expect(tools.has(tool), tool).toBe(false);
  });

  it("is given its tools by its role even when its file lists nothing of the app's", () => {
    const dir = project();
    ensureDefaultAgents(dir);
    writeFileSync(
      join(agentsDir(dir), "simulation.md"),
      "---\nname: simulation\ndescription: Sim.\ntools: Read, mcp__hai__create_elements\n---\n\nSim.\n",
    );
    const tools = allowedHaiTools(member(dir));
    expect(tools.has("surface_temperature")).toBe(true);
    expect(tools.has("create_elements")).toBe(false);
  });

  it("keeps the Ladybug tools of the user's own MCP server in its Claude Code definition", () => {
    const dir = project();
    ensureDefaultAgents(dir);
    const { tools } = managedDefinition(member(dir));
    expect(tools).toContain("mcp__ladybug__*");
    expect(tools).toContain("mcp__hai__surface_temperature");
    expect(tools).not.toContain("mcp__hai__create_elements");
  });

  it("the simulation tools are Simulation's alone", () => {
    const dir = project();
    ensureDefaultAgents(dir);
    for (const name of ["mochi", "reviewer", "architect", "product", "climate", "urban"]) {
      const found = readRoster(dir).find((m) => m.name === name) as ReturnType<typeof member>;
      const tools = allowedHaiTools(found);
      for (const tool of ["surface_temperature", "simulation_geometry"])
        expect(tools.has(tool), `${name} ${tool}`).toBe(false);
    }
  });

  it("a project from before Simulation gains it and keeps every edit", () => {
    const dir = project();
    ensureDefaultAgents(dir);
    rmSync(join(agentsDir(dir), "simulation.md"));
    const edited = "---\nname: urban\ndescription: Mine.\ntools: Read\n---\n\nMine.\n";
    writeFileSync(join(agentsDir(dir), "urban.md"), edited);
    expect(ensureDefaultAgents(dir)).toEqual(["simulation"]);
    expect(readFileSync(join(agentsDir(dir), "urban.md"), "utf8")).toBe(edited);
  });

  it("says what it cannot do without Ladybug and never calls a result compliant", () => {
    const dir = project();
    ensureDefaultAgents(dir);
    const { prompt } = member(dir);
    expect(prompt).toContain("not installed");
    expect(prompt).toContain("Never call a result compliant");
    expect(prompt).toContain("(not the air)");
  });
});
