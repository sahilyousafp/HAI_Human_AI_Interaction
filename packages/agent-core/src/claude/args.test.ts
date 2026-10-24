import { describe, expect, it } from "vitest";
import { buildClaudeArgs } from "./provider.ts";

const base = {
  cwd: "D:/project",
  mcpConfigPath: "mcp.json",
  systemPromptPath: "system.md",
  permissionPromptTool: "mcp__hai__approve_tool",
};

describe("buildClaudeArgs", () => {
  it("runs the session as a named agent of the project when one is given", () => {
    const args = buildClaudeArgs({ ...base, agent: "architect" });
    expect(args.slice(args.indexOf("--agent"), args.indexOf("--agent") + 2)).toEqual([
      "--agent",
      "architect",
    ]);
  });

  it("leaves --agent and --resume out when not given", () => {
    const args = buildClaudeArgs(base);
    expect(args).not.toContain("--agent");
    expect(args).not.toContain("--resume");
  });
});

describe("buildClaudeArgs with the app's definition of the agent", () => {
  it("passes the definition file after --agent", () => {
    const args = buildClaudeArgs({ ...base, agent: "architect", agentsPath: "agents.json" });
    expect(args.slice(args.indexOf("--agents"), args.indexOf("--agents") + 2)).toEqual([
      "--agents",
      "agents.json",
    ]);
    expect(args.indexOf("--agents")).toBeGreaterThan(args.indexOf("--agent"));
  });

  it("is left out without an agent or without a definition", () => {
    expect(buildClaudeArgs({ ...base, agentsPath: "agents.json" })).not.toContain("--agents");
    expect(buildClaudeArgs({ ...base, agent: "architect" })).not.toContain("--agents");
  });
});
