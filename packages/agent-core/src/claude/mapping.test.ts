import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentEvent } from "@hai/protocol";
import { AgentEvent as AgentEventSchema } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { createClaudeMapper, createLineSplitter, mcpServerOf, SUMMARY_MAX } from "./mapping.ts";

const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, "..", "..", "fixtures", name), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as Record<string, unknown>);

function mapAll(lines: Array<Record<string, unknown>>): AgentEvent[] {
  const map = createClaudeMapper();
  return lines.flatMap((l) => map(l));
}

describe("mapping the recorded Claude Code stream (two turns)", () => {
  const events = mapAll(fixture("two-turns.ndjson"));

  it("produces only valid agent events", () => {
    for (const event of events) expect(AgentEventSchema.safeParse(event).success).toBe(true);
  });

  it("starts each turn with init: session id, version, tools, servers with status and scope, skills", () => {
    const inits = events.filter((e) => e.type === "init");
    expect(inits).toHaveLength(2); // the CLI reports its setup at the start of every turn
    const init = inits[0];
    if (init?.type !== "init") throw new Error("no init");
    expect(init.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(init.version).toBe("2.1.303");
    expect(init.tools).toContain("Glob");
    expect(init.mcpServers.find((s) => s.name === "broken-server")).toEqual({
      name: "broken-server",
      status: "failed",
      scope: "session",
    });
    expect(new Set(init.mcpServers.map((s) => s.scope))).toEqual(
      new Set(["plugin", "user", "session", "claude.ai"]),
    );
    expect(init.skills).toEqual([{ name: "example-skill", scope: "unknown" }]);
  });

  it("reports the Glob call once, then its result", () => {
    const start = events.find((e) => e.type === "tool.start");
    expect(start).toEqual({
      type: "tool.start",
      id: expect.stringMatching(/^toolu_/),
      name: "Glob",
      input: { pattern: "*.txt" },
    });
    const end = events.find((e) => e.type === "tool.end");
    expect(end).toMatchObject({ type: "tool.end", outcome: "done", summary: "notes.txt brief.txt" });
    expect(end?.type === "tool.end" && start?.type === "tool.start" && end.id === start.id).toBe(true);
    expect(events.filter((e) => e.type === "tool.start")).toHaveLength(1);
  });

  it("streams reply text, and each turn ends with usage", () => {
    const text = events
      .filter((e): e is Extract<AgentEvent, { type: "text.delta" }> => e.type === "text.delta")
      .map((e) => e.text)
      .join("");
    expect(text).toContain("2");
    const ends = events.filter((e) => e.type === "turn.end");
    expect(ends).toHaveLength(2);
    for (const end of ends) {
      expect(end).toMatchObject({ reason: "done", usage: { outputTokens: expect.any(Number) } });
    }
  });

  it("orders each turn: init first, turn.end last", () => {
    const firstEnd = events.findIndex((e) => e.type === "turn.end");
    expect(events[0]?.type).toBe("init");
    expect(events.slice(0, firstEnd).some((e) => e.type === "tool.start")).toBe(true);
    expect(events[firstEnd + 1]?.type).toBe("init");
    expect(events.at(-1)?.type).toBe("turn.end");
  });
});

describe("mapping edge cases", () => {
  it("a failed tool result is reported as failed, with a short summary", () => {
    const map = createClaudeMapper();
    const [end] = map({
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: "x".repeat(2000) }],
      },
    });
    expect(end).toMatchObject({ type: "tool.end", id: "t1", outcome: "failed" });
    expect(end?.type === "tool.end" && end.summary.length).toBe(SUMMARY_MAX);
  });

  it("an error result becomes an error event and a turn ending in error", () => {
    const events = createClaudeMapper()({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      result: "Overloaded",
    });
    expect(events).toEqual([
      { type: "error", message: "Overloaded" },
      { type: "turn.end", reason: "error" },
    ]);
  });

  it("names the MCP server of an MCP tool", () => {
    expect(mcpServerOf("mcp__hai__create_elements")).toBe("hai");
    expect(mcpServerOf("Bash")).toBeUndefined();
  });

  it("ignores hooks, status, rate limits and message framing", () => {
    const map = createClaudeMapper();
    for (const raw of [
      { type: "system", subtype: "hook_started" },
      { type: "system", subtype: "status", status: "requesting" },
      { type: "rate_limit_event" },
      { type: "stream_event", event: { type: "message_start" } },
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "input_json_delta" } } },
    ]) {
      expect(map(raw)).toEqual([]);
    }
  });
});

describe("createLineSplitter", () => {
  it("joins lines split across chunks and skips blank lines", () => {
    const lines: string[] = [];
    const split = createLineSplitter((l) => lines.push(l));
    split('{"a":');
    split('1}\n\n{"b"');
    split(":2}\n");
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
  });
});
