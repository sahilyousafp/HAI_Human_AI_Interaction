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
