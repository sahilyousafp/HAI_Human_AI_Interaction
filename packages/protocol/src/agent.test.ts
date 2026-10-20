import { describe, expect, it } from "vitest";
import { AgentEvent, AgentStatus, AgentTurn, ApprovalRequest } from "./agent.ts";
import { parseMessage } from "./messages.ts";

describe("AgentEvent", () => {
  it.each([
    {
      type: "init",
      sessionId: "s1",
      tools: ["Read", "mcp__aex__get_scene_summary"],
      mcpServers: [{ name: "aex", status: "connected", scope: "session" }],
      skills: [{ name: "pdf", description: "Read PDFs" }],
    },
    { type: "text.delta", text: "Adding three floors" },
    {
      type: "tool.start",
      id: "t1",
      name: "mcp__aex__create_elements",
      server: "aex",
      input: { elements: [] },
    },
    { type: "tool.end", id: "t1", outcome: "failed", summary: 'Element "w1": height must be greater than 0' },
    { type: "turn.end", reason: "done", usage: { inputTokens: 10, outputTokens: 5 }, durationMs: 1200 },
    { type: "error", message: "The agent process ended" },
  ])("accepts $type", (event) => {
    expect(AgentEvent.safeParse(event).success).toBe(true);
  });

  it.each([
    ["an unknown type", { type: "thinking", text: "x" }],
    ["a tool end with an unknown outcome", { type: "tool.end", id: "t1", outcome: "maybe", summary: "" }],
    ["an init without its session id", { type: "init", tools: [], mcpServers: [], skills: [] }],
  ])("rejects %s", (_name, event) => {
    expect(AgentEvent.safeParse(event).success).toBe(false);
  });

  it("defaults the scope of servers and skills to unknown", () => {
    const parsed = AgentEvent.parse({
      type: "init",
      sessionId: "s1",
      tools: [],
      mcpServers: [{ name: "github", status: "failed", error: "spawn ENOENT" }],
      skills: [{ name: "pdf" }],
    });
    expect(parsed.type === "init" && parsed.mcpServers[0]?.scope).toBe("unknown");
    expect(parsed.type === "init" && parsed.skills[0]?.scope).toBe("unknown");
  });
});

describe("agent status, turns and approvals", () => {
  it("an unavailable status carries the reason and the fix", () => {
    expect(
      AgentStatus.safeParse({
        state: "unavailable",
        reason: "Claude Code is not installed.",
        fix: "Install it",
      }).success,
    ).toBe(true);
    expect(AgentStatus.safeParse({ state: "busy" }).success).toBe(false);
  });

  it("a turn keeps its events in order", () => {
    const turn = AgentTurn.parse({
      id: "turn-1",
      request: "add three floors",
      events: [
        { type: "text.delta", text: "Done" },
        { type: "turn.end", reason: "done" },
      ],
    });
    expect(turn.events.map((e) => e.type)).toEqual(["text.delta", "turn.end"]);
    expect(turn.recovered).toBe(false);
  });

  it("an approval request names the tool, its source and a summary", () => {
    expect(
      ApprovalRequest.safeParse({
        id: "a1",
        tool: "Bash",
        source: "Claude Code",
        summary: "npm install",
        input: { command: "npm install" },
        expiresAt: Date.now() + 60_000,
      }).success,
    ).toBe(true);
  });
});

describe("agent messages", () => {
  const parse = (message: object) => parseMessage(JSON.stringify({ id: "m1", ...message }));

  it("accepts a typed request, a stop and an approval decision from a client", () => {
    expect(parse({ type: "agent.send", payload: { text: "add three floors of 3.5 m" } }).ok).toBe(true);
    expect(parse({ type: "agent.stop", payload: {} }).ok).toBe(true);
    expect(parse({ type: "approval.decide", payload: { id: "a1", decision: "always" } }).ok).toBe(true);
  });

  it("rejects an empty request and an unknown decision", () => {
    expect(parse({ type: "agent.send", payload: { text: "" } }).ok).toBe(false);
    expect(parse({ type: "approval.decide", payload: { id: "a1", decision: "maybe" } }).ok).toBe(false);
  });

  it("carries agent events to clients", () => {
    expect(
      parse({ type: "agent.event", payload: { turnId: "turn-1", event: { type: "text.delta", text: "Hi" } } })
        .ok,
    ).toBe(true);
  });
});
