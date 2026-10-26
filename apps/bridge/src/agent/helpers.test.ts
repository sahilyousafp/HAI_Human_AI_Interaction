import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HAI_TOOLS } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { writeAgentConfig } from "./agent-config.ts";
import { defaultRoster, helperDefinitions, managedDefinition, workerDefinition } from "./roster.ts";

const team = defaultRoster();
const member = (name: string) => {
  const found = team.find((m) => m.name === name);
  if (!found) throw new Error(`no ${name}`);
  return found;
};

/** Everything an agent could change the model or run code with, which no helper may be given. */
const FORBIDDEN = [
  ...HAI_TOOLS.write,
  ...HAI_TOOLS.tags,
  ...HAI_TOOLS.panel,
  ...HAI_TOOLS.python,
  ...HAI_TOOLS.rhino,
  ...HAI_TOOLS.workers,
  ...HAI_TOOLS.team,
  ...HAI_TOOLS.view,
  ...HAI_TOOLS.claims,
  ...HAI_TOOLS.cameras,
  ...HAI_TOOLS.climate,
]
  .map((t) => `mcp__hai__${t}`)
  .concat(["Bash", "Write", "Edit", "NotebookEdit", "Task", "Agent"]);

describe("subagents that only look", () => {
  it("every agent may start Claude Code's own subagents", () => {
    for (const m of team) {
      const tools = managedDefinition(m).tools;
      expect(tools, m.name).toEqual(expect.arrayContaining(["Task", "Agent"]));
    }
    // A worker too: a helper acts as its parent, which is not a way to change the model.
    expect(workerDefinition(member("architect")).tools).toEqual(expect.arrayContaining(["Task"]));
  });

  it("no helper has a tool that changes the model, runs a script, starts work or moves the user's camera", () => {
    for (const m of team) {
      for (const [name, helper] of Object.entries(helperDefinitions(m, team))) {
        const bad = helper.tools.filter((t) => FORBIDDEN.includes(t));
        expect(bad, `${m.name}'s helper ${name}`).toEqual([]);
        expect(helper.tools, `${m.name}'s helper ${name}`).toEqual(
          expect.arrayContaining(["Read", "mcp__hai__get_elements"]),
        );
      }
    }
  });

  it("there is one for every other team name, plus scout and checker, and none named after the agent itself", () => {
    const names = Object.keys(helperDefinitions(member("architect"), team)).sort();
    expect(names).toEqual([
      "checker",
      "climate",
      "mochi",
      "product",
      "reviewer",
      "scout",
      "simulation",
      "urban",
    ]);
  });

  it("a helper named after a teammate has the teammate's way of looking, not its modelling tools", () => {
    const product = helperDefinitions(member("architect"), team).product;
    expect(product?.prompt).toContain(member("product").prompt);
    expect(product?.prompt).toContain("you cannot change the model or run scripts");
    expect(product?.tools.some((t) => t.includes("create_elements") || t.includes("python_run"))).toBe(false);
    // The teammate's own tools are still its own: Product, run as an agent, can change the model.
    expect(managedDefinition(member("product")).tools).toContain("mcp__hai__create_elements");
  });

  it("only scout may search the web", () => {
    const helpers = helperDefinitions(member("architect"), team);
    expect(helpers.scout?.tools).toEqual(expect.arrayContaining(["WebSearch", "WebFetch"]));
    expect(helpers.checker?.tools).not.toContain("WebSearch");
    expect(helpers.reviewer?.tools).not.toContain("WebFetch");
  });

  it("the agent's own entry and its helpers are written to its agents.json, its own entry winning", () => {
    const dir = mkdtempSync(join(tmpdir(), "hai-helpers-"));
    const architect = member("architect");
    const paths = writeAgentConfig(
      dir,
      { url: "http://127.0.0.1:1/mcp", token: "t" },
      {
        agent: "architect",
        definition: managedDefinition(architect),
        helpers: {
          ...helperDefinitions(architect, team),
          architect: { description: "x", prompt: "x", tools: ["Read"] },
        },
      },
    );
    const written = JSON.parse(readFileSync(paths.agentsPath as string, "utf8")) as Record<
      string,
      { tools: string[] }
    >;
    expect(Object.keys(written).sort()).toEqual([
      "architect",
      "checker",
      "climate",
      "mochi",
      "product",
      "reviewer",
      "scout",
      "simulation",
      "urban",
    ]);
    expect(written.architect?.tools).toContain("mcp__hai__create_elements");
  });
});
