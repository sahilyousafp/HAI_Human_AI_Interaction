import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildClaudeArgs } from "./provider.ts";

const doc = readFileSync(join(import.meta.dirname, "..", "..", "..", "..", "docs", "agent.md"), "utf8");

describe("docs/agent.md", () => {
  it("documents the exact flags the session is started with", () => {
    const command = /```text\r?\n(claude [^\r\n]+)\r?\n```/.exec(doc)?.[1];
    expect(command, "a text code block with the claude command").toBeDefined();
    const documented = (command ?? "").split(/\s+/).filter((token) => token.startsWith("-"));
    const actual = buildClaudeArgs({
      cwd: "D:/project",
      mcpConfigPath: "mcp.json",
      systemPromptPath: "system.md",
      permissionPromptTool: "mcp__aex__approve_tool",
      resumeSessionId: "session",
    }).filter((arg) => arg.startsWith("-"));
    expect(documented).toEqual(actual);
    expect(command).toContain("mcp__aex__approve_tool");
  });
});
