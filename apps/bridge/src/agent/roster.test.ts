import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "./frontmatter.ts";
import { agentsDir, allowedAexTools, ensureDefaultAgents, readRoster, rosterText } from "./roster.ts";

const project = () => mkdtempSync(join(tmpdir(), "aex-roster-"));

describe("the team", () => {
  it("defaults created once: mochi on Sonnet and four specialists, as Claude Code agent files", () => {
    const dir = project();
    expect(ensureDefaultAgents(dir).sort()).toEqual(["architect", "climate", "mochi", "product", "reviewer"]);
    expect(ensureDefaultAgents(dir)).toEqual([]); // nothing to write the second time
    const team = readRoster(dir);
    expect(team.map((m) => m.name)).toEqual(["mochi", "architect", "climate", "product", "reviewer"]);
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
      "---\nname: structure\ndescription: Structural sizing.\ntools: mcp__aex__get_elements\n---\n\nYou are Structure.\n",
    );
    const team = readRoster(dir);
    const structure = team.find((m) => m.name === "structure");
    expect(structure).toMatchObject({ writes: true, lead: false, aliases: [] });
    expect(rosterText(team)).toContain("- structure: Structural sizing.");
    expect(rosterText(team)).not.toContain("mochi");
  });

  it("each agent's aex tools come from its definition; Reviewer only reads", () => {
    const dir = project();
    ensureDefaultAgents(dir);
    const team = readRoster(dir);
    const tools = (name: string) => {
      const member = team.find((m) => m.name === name);
      if (!member) throw new Error(`no ${name}`);
      return allowedAexTools(member);
    };
    expect([...tools("reviewer")].sort()).toEqual([
      "capture_view",
      "get_elements",
      "get_scene_summary",
      "get_user_context",
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
      "---\nname: climate\ndescription: Sun.\ntools: mcp__aex__get_elements, mcp__aex__create_elements\n---\n\nSun.\n",
    );
    const climate = readRoster(dir).find((m) => m.name === "climate");
    if (!climate) throw new Error("no climate");
    expect([...allowedAexTools(climate)]).toEqual(["get_elements"]);
    expect([...allowedAexTools({ ...climate, writes: true })].sort()).toEqual([
      "create_elements",
      "get_elements",
    ]);
  });

  it("AEX metadata in .aex/agents.json overrides the defaults", () => {
    const dir = project();
    ensureDefaultAgents(dir);
    mkdirSync(join(dir, ".aex"), { recursive: true });
    writeFileSync(
      join(dir, ".aex", "agents.json"),
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
