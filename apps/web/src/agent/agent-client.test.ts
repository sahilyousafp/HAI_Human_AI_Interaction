import type { AgentEvent, ApprovalRequest, Message } from "@aex/protocol";
import { describe, expect, it } from "vitest";
import { AgentClient, foldEvents, type TurnItem } from "./agent-client.ts";

function setup() {
  const sent: Message[] = [];
  const client = new AgentClient((m) => {
    sent.push(m);
    return true;
  });
  const receive = (type: string, payload: unknown) => client.handle({ type, id: "x", payload } as Message);
  return { client, sent, receive };
}

const card = (id: string, toolUseId?: string): ApprovalRequest => ({
  id,
  tool: "Bash",
  source: "Claude Code",
  summary: "ls",
  input: { command: "ls" },
  ...(toolUseId ? { toolUseId } : {}),
  expiresAt: Date.now() + 60_000,
});

describe("foldEvents", () => {
  it("joins streamed text and keeps tool calls in order", () => {
    const events: AgentEvent[] = [
      { type: "text.delta", text: "Adding " },
      { type: "text.delta", text: "floors." },
      { type: "tool.start", id: "t1", name: "mcp__aex__create_elements", server: "aex", input: {} },
      { type: "tool.end", id: "t1", outcome: "failed", summary: "height must be positive" },
      { type: "text.delta", text: "Fixed." },
    ];
    const items = events.reduce<TurnItem[]>(foldEvents, []);
    expect(items).toEqual([
      { kind: "text", text: "Adding floors." },
      {
        kind: "tool",
        id: "t1",
        name: "mcp__aex__create_elements",
        server: "aex",
        input: {},
        outcome: "failed",
        summary: "height must be positive",
      },
      { kind: "text", text: "Fixed." },
    ]);
  });
});

describe("AgentClient", () => {
  it("replays the transcript a reloaded page receives, with pending cards", () => {
    const { client, receive } = setup();
    receive("agent.transcript", {
      status: { state: "idle" },
      pending: [card("a1")],
      turns: [
        {
          id: "t",
          request: "hi",
          recovered: true,
          events: [
            { type: "text.delta", text: "Hello" },
            { type: "turn.end", reason: "done" },
          ],
        },
      ],
    });
    const state = client.getSnapshot();
    expect(state.turns[0]).toMatchObject({ request: "hi", recovered: true, ended: "done" });
    expect(state.turns[0]?.items).toEqual([{ kind: "text", text: "Hello" }]);
    expect(client.pending.map((a) => a.request.id)).toEqual(["a1"]);
  });

  it("streams a live turn and records its approval outcome", () => {
    const { client, receive } = setup();
    receive("agent.turn", { id: "t", request: "list files", recovered: false });
    receive("agent.event", { turnId: "t", event: { type: "text.delta", text: "On it" } });
    receive("approval.pending", card("a1", "toolu_1"));
    receive("approval.resolved", { id: "a1", outcome: "denied" });
    expect(client.getSnapshot().turns[0]?.items).toEqual([{ kind: "text", text: "On it" }]);
    expect(client.getSnapshot().approvals[0]?.outcome).toBe("denied");
    expect(client.pending).toEqual([]);
  });

  it("shows a refused request only when it was this page's own", () => {
    const { client, sent, receive } = setup();
    client.request("hello");
    const requestId = sent[0]?.id ?? "";
    expect(receive("request.error", { requestId: "someone-else", message: "x" })).toBe(false);
    expect(receive("request.error", { requestId, message: "Open a project first." })).toBe(true);
    expect(client.getSnapshot().error).toBe("Open a project first.");
  });

  it("yes allows the only pending card, but only while engaged", () => {
    const { client, sent, receive } = setup();
    receive("approval.pending", card("a1"));
    expect(client.answer(true, false)).toBe(false);
    expect(client.answer(true, true)).toBe(true);
    expect(sent.at(-1)).toMatchObject({ type: "approval.decide", payload: { id: "a1", decision: "allow" } });
  });

  it("no denies the only pending card; with two cards, neither decides anything", () => {
    const { client, sent, receive } = setup();
    receive("approval.pending", card("a1"));
    expect(client.answer(false, false)).toBe(true);
    expect(sent.at(-1)).toMatchObject({ payload: { id: "a1", decision: "deny" } });

    receive("approval.pending", card("a2"));
    expect(client.answer(false, true)).toBe(false);
    expect(client.answer(true, true)).toBe(false);
  });

  it("stopRunning stops only a running turn", () => {
    const { client, sent, receive } = setup();
    client.stopRunning();
    expect(sent).toEqual([]);
    receive("agent.status", { status: { state: "working" } });
    client.stopRunning();
    expect(sent.at(-1)?.type).toBe("agent.stop");
  });

  it("keeps the always-allowed list and sends revokes", () => {
    const { client, sent, receive } = setup();
    receive("approvals.allowed", { tools: ["WebSearch"] });
    expect(client.getSnapshot().alwaysAllowed).toEqual(["WebSearch"]);
    client.revoke("WebSearch");
    expect(sent.at(-1)).toMatchObject({ type: "approvals.revoke", payload: { tool: "WebSearch" } });
  });

  it("extension changes: busy until the bridge confirms, and a refusal shows in the extensions view", () => {
    const { client, sent, receive } = setup();
    const extensions = { loaded: null, projectServers: [], projectSkills: [] };
    client.installSkill("D:/skills/none");
    expect(client.getSnapshot().extensionsBusy).toBe(true);
    receive("request.error", {
      requestId: sent.at(-1)?.id,
      message: "SKILL.md is missing in D:/skills/none.",
    });
    expect(client.getSnapshot()).toMatchObject({
      extensionsBusy: false,
      extensionsResult: { ok: false, message: "SKILL.md is missing in D:/skills/none." },
      error: null, // not a chat error
    });
    client.removeServer("files");
    receive("extensions.snapshot", { ...extensions, notice: "Removed the MCP server files." });
    expect(client.getSnapshot()).toMatchObject({
      extensions,
      extensionsBusy: false,
      extensionsResult: { ok: true, message: "Removed the MCP server files." },
    });
  });
});

describe("the team in the client", () => {
  const member = (name: string, lead = false) => ({
    name,
    description: name,
    tools: [],
    aliases: [],
    color: "#888888",
    writes: !lead,
    lead,
  });
  const task = (status: string) => ({
    id: "task-1",
    agent: "architect",
    title: "Stair core",
    instruction: "Add a stair core",
    status,
    createdAt: 1,
    fromTurn: "m1",
  });
  const team = (status = "running") => ({
    members: [member("mochi", true), member("architect")],
    tasks: [task(status)],
    maxRunning: 3,
  });

  it("each agent's turns go to its own thread; Mochi's are the chat", () => {
    const { client, receive } = setup();
    receive("team.snapshot", team());
    receive("agent.turn", {
      id: "m1",
      request: "stair core here",
      recovered: false,
      kind: "request",
      agent: "mochi",
    });
    receive("agent.turn", {
      id: "a1",
      request: "Add a stair core",
      recovered: false,
      kind: "task",
      taskId: "task-1",
      agent: "architect",
    });
    receive("agent.event", {
      turnId: "a1",
      event: { type: "text.delta", text: "Done." },
      agent: "architect",
    });
    receive("agent.status", { status: { state: "working" }, agent: "architect" });
    const state = client.getSnapshot();
    expect(state.turns.map((t) => t.id)).toEqual(["m1"]);
    expect(client.thread("architect")).toMatchObject({
      status: { state: "working" },
      turns: [{ id: "a1", kind: "task", taskId: "task-1", items: [{ kind: "text", text: "Done." }] }],
    });
    expect(state.status).toBeNull(); // Mochi's status is untouched by Architect's
  });

  it("a page that connects gets every agent's transcript, and cards from each", () => {
    const { client, receive } = setup();
    receive("agent.transcript", { turns: [], status: { state: "idle" }, pending: [], agent: "mochi" });
    const running = { id: "a1", request: "x", events: [], recovered: false, kind: "task", taskId: "task-1" };
    receive("agent.transcript", {
      turns: [running],
      status: { state: "working" },
      pending: [{ ...card("c1"), agent: "architect" }],
      agent: "architect",
    });
    expect(client.getSnapshot().status).toEqual({ state: "idle" });
    expect(client.pending.map((a) => [a.request.id, a.turnId])).toEqual([["c1", "a1"]]);
  });

  it("an approval card belongs to the running turn of the agent asking", () => {
    const { client, receive } = setup();
    receive("agent.turn", { id: "m1", request: "x", recovered: false, kind: "request", agent: "mochi" });
    receive("agent.turn", { id: "a1", request: "y", recovered: false, kind: "task", agent: "architect" });
    receive("approval.pending", { ...card("c1"), agent: "architect" });
    receive("approval.pending", { ...card("c2"), agent: "mochi" });
    expect(client.pending.map((a) => a.turnId)).toEqual(["a1", "m1"]);
  });

  it("two open palms stop everything while a specialist works, even when Mochi is idle", () => {
    const { client, sent, receive } = setup();
    receive("agent.status", { status: { state: "idle" }, agent: "mochi" });
    client.stopRunning();
    expect(sent).toEqual([]);
    receive("team.snapshot", team("running"));
    client.stopRunning();
    expect(sent.map((m) => m.type)).toEqual(["agent.stop"]);
    receive("team.snapshot", team("done"));
    client.stopRunning();
    expect(sent).toHaveLength(1);
  });

  it("stops one task, and sends the specialist the user named", () => {
    const { client, sent } = setup();
    client.stopTask("task-1");
    client.request("add a stair core", undefined, "architect");
    expect(sent.map((m) => [m.type, m.payload])).toEqual([
      ["task.stop", { id: "task-1" }],
      ["agent.send", { text: "add a stair core", agent: "architect" }],
    ]);
  });

  it("asks by name: a named specialist travels with the request, without its name", () => {
    const { client, sent, receive } = setup();
    receive("team.snapshot", {
      members: [
        { ...member("mochi", true), aliases: ["machi"] },
        { ...member("reviewer"), aliases: ["review or"] },
      ],
      tasks: [],
      maxRunning: 3,
    });
    client.ask("Review or check the floor heights");
    client.ask("Machi, status?");
    client.ask("add three floors");
    client.ask("Mochi");
    expect(sent.map((m) => m.payload)).toEqual([
      { text: "check the floor heights", agent: "reviewer" },
      { text: "status?" },
      { text: "add three floors" },
      { text: "Mochi" },
    ]);
  });

  it("a bridge without a team: messages without a name are the chat's", () => {
    const { client, receive } = setup();
    receive("agent.turn", { id: "t1", request: "x", recovered: false, kind: "request" });
    expect(client.getSnapshot().turns.map((t) => t.id)).toEqual(["t1"]);
  });
});
