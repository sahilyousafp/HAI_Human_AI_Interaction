import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent, Message } from "@hai/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { fakeProvider } from "../../test/fake-provider.ts";
import { connectClient } from "../../test/ws-client.ts";
import { type Bridge, createBridge } from "../server.ts";
import { ApprovalBroker, readAlwaysAllowed, summarizeInput, toolSource } from "./approvals.ts";

const temp = (prefix: string) => mkdtempSync(join(tmpdir(), prefix));

describe("approval cards describe the call", () => {
  it("names the source: the MCP server, or Claude Code for built-in tools", () => {
    expect(toolSource("mcp__github__create_issue")).toBe("github");
    expect(toolSource("Bash")).toBe("Claude Code");
  });

  it("summarises the input: the command for Bash, a path or URL for others, else compact JSON", () => {
    expect(summarizeInput("Bash", { command: "rm -rf dist", description: "Clean" })).toBe("rm -rf dist");
    expect(summarizeInput("WebFetch", { url: "https://example.com", prompt: "x" })).toBe(
      "https://example.com",
    );
    expect(summarizeInput("mcp__x__y", { a: 1 })).toBe('{"a":1}');
    expect(summarizeInput("mcp__x__y", { text: "z".repeat(500) })).toHaveLength(300);
  });
});

describe("ApprovalBroker", () => {
  function setup(timeoutMs = 60_000) {
    const projectDir = temp("hai-approvals-");
    const sent: Message[] = [];
    const broker = new ApprovalBroker({ projectDir: () => projectDir, timeoutMs }, (m) => sent.push(m));
    const card = () => sent.find((m) => m.type === "approval.pending");
    const outcome = () => sent.find((m) => m.type === "approval.resolved")?.payload;
    const decide = (id: string, decision: "allow" | "deny" | "always") =>
      broker.handle({ type: "approval.decide", id: "d", payload: { id, decision } });
    return { broker, projectDir, sent, card, outcome, decide };
  }

  it("the app's scene tools are allowed at once, with no card", async () => {
    const { broker, sent } = setup();
    const input = { elements: [] };
    expect(await broker.decide("mcp__hai__create_elements", input)).toEqual({
      behavior: "allow",
      updatedInput: input,
    });
    expect(sent).toEqual([]);
  });

  it.each(["offer_panel", "open_panel", "update_panel", "close_panel"])(
    "the panel tool %s is allowed at once: the user's nod is the consent, so no card",
    async (name) => {
      const { broker, sent } = setup();
      const input = { purpose: "Set the clearance" };
      expect(await broker.decide(`mcp__hai__${name}`, input)).toEqual({
        behavior: "allow",
        updatedInput: input,
      });
      expect(sent).toEqual([]);
    },
  );

  it("anything else waits for the user; Deny tells the agent the user declined", async () => {
    const { broker, card, outcome, decide } = setup();
    const decision = broker.decide("Bash", { command: "ls" });
    const pending = card();
    expect(pending?.payload).toMatchObject({ tool: "Bash", source: "Claude Code", summary: "ls" });
    expect(broker.waiting).toHaveLength(1);
    decide(pending?.payload.id ?? "", "deny");
    expect(await decision).toEqual({ behavior: "deny", message: "The user declined this tool call." });
    expect(outcome()).toMatchObject({ outcome: "denied" });
    expect(broker.waiting).toEqual([]);
  });

  describe("with fake timers", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("timeout: an unanswered card is denied after 60 seconds and says it timed out", async () => {
      const { broker, outcome } = setup();
      const decision = broker.decide("WebSearch", { query: "fire codes" });
      vi.advanceTimersByTime(59_999);
      expect(outcome()).toBeUndefined();
      vi.advanceTimersByTime(1);
      expect(await decision).toMatchObject({
        behavior: "deny",
        message: expect.stringMatching(/did not answer/),
      });
      expect(outcome()).toMatchObject({ outcome: "timed-out" });
    });
  });

  it("remembered approval: Always allow pre-approves the tool for this project, even after a restart", async () => {
    const { broker, projectDir, card, decide } = setup();
    const first = broker.decide("WebSearch", { query: "a" });
    decide(card()?.payload.id ?? "", "always");
    expect(await first).toMatchObject({ behavior: "allow" });
    expect(readAlwaysAllowed(projectDir)).toEqual(["WebSearch"]);

    // A new broker reads the project's list from disk, as after a bridge restart.
    const sent: Message[] = [];
    const restarted = new ApprovalBroker({ projectDir: () => projectDir }, (m) => sent.push(m));
    expect(await restarted.decide("WebSearch", { query: "b" })).toMatchObject({ behavior: "allow" });
    expect(sent).toEqual([]);
  });

  it("revoke: a tool removed from the always-allowed list asks again, and clients see the new list", async () => {
    const { broker, sent, card, decide } = setup();
    const first = broker.decide("WebSearch", { query: "a" });
    decide(card()?.payload.id ?? "", "always");
    await first;
    expect(sent.filter((m) => m.type === "approvals.allowed").at(-1)?.payload.tools).toEqual(["WebSearch"]);

    broker.handle({ type: "approvals.revoke", id: "r", payload: { tool: "WebSearch" } });
    expect(sent.filter((m) => m.type === "approvals.allowed").at(-1)?.payload.tools).toEqual([]);
    sent.length = 0;
    void broker.decide("WebSearch", { query: "b" }, "toolu_1");
    expect(card()?.payload).toMatchObject({ tool: "WebSearch", toolUseId: "toolu_1" });
  });

  it("stopping the turn denies the cards it was waiting on", async () => {
    const { broker, outcome } = setup();
    const decision = broker.decide("Bash", { command: "sleep 100" });
    broker.denyAll("The user stopped the request.");
    expect(await decision).toEqual({ behavior: "deny", message: "The user stopped the request." });
    expect(outcome()).toMatchObject({ outcome: "denied" });
  });
});

describe("approvals with the fake Claude Code CLI", () => {
  const ORIGIN = "http://localhost:5173";
  const TOKEN = "approval-test-token-0123456789";
  let bridge: Bridge | null = null;
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.close();
    await bridge?.stop();
    bridge = null;
  });

  async function start() {
    bridge = createBridge({
      host: "127.0.0.1",
      port: 0,
      allowedOrigins: [ORIGIN],
      version: "t",
      token: TOKEN,
      scene: { projectDir: join(temp("hai-approval-it-"), "project"), saveDelayMs: 50 },
      agent: { provider: fakeProvider(temp("hai-fake-state-")) },
    });
    const address: AddressInfo = await bridge.start();
    await bridge.agent?.ready;
    const viewer = await connectClient(address, { token: TOKEN, origin: ORIGIN, track: sockets });
    return { address, viewer, agent: bridge.agent, scene: bridge.scene };
  }

  const reply = (events: AgentEvent[]) =>
    events
      .filter((e): e is Extract<AgentEvent, { type: "text.delta" }> => e.type === "text.delta")
      .map((e) => e.text)
      .join("");

  it("scene edit runs without a prompt", async () => {
    const { viewer, agent, scene } = await start();
    await agent?.request("delegate architect: column");
    await agent?.settled();
    expect(viewer.received.some((m) => m.type === "approval.pending")).toBe(false);
    expect(Object.values(scene.scene.doc.elements).some((e) => e.name === "Fake column")).toBe(true);
  });

  it("shell command needs approval: a card with the command, and the turn waits for the decision", async () => {
    const { address, viewer, agent } = await start();
    const turn = agent?.request("shell: echo hi");
    const card = await viewer.waitFor("approval.pending");
    expect(card.payload).toMatchObject({
      tool: "Bash",
      source: "Claude Code",
      summary: "echo hi",
      agent: "mochi",
    });
    expect(agent?.hub("mochi").runningTurn).not.toBeNull(); // waiting
    // A page that connects now sees the card too.
    const late = await connectClient(address, { token: TOKEN, origin: ORIGIN, track: sockets });
    const transcript = await late.waitFor("agent.transcript");
    expect(transcript.payload.pending.map((p) => p.id)).toEqual([card.payload.id]);

    viewer.send("approval.decide", { id: card.payload.id, decision: "allow" });
    await turn;
    await viewer.waitFor("agent.event", (m) => m.payload.event.type === "turn.end");
    expect(reply(lastTurnEvents(viewer.received))).toBe("Done: ran: echo hi");
    await viewer.waitFor("approval.resolved", (m) => m.payload.outcome === "allowed");
  });

  it("shake or Deny: the command does not run and the agent is told the user declined", async () => {
    const { viewer, agent } = await start();
    const turn = agent?.request("shell: rm -rf build");
    const card = await viewer.waitFor("approval.pending");
    viewer.send("approval.decide", { id: card.payload.id, decision: "deny" });
    await turn;
    await viewer.waitFor("agent.event", (m) => m.payload.event.type === "turn.end");
    expect(reply(lastTurnEvents(viewer.received))).toBe(
      "I did not run it: The user declined this tool call.",
    );
  });
});

/** The events of the most recent turn, as a client received them. */
function lastTurnEvents(received: Message[]): AgentEvent[] {
  const turnId = received.filter((m) => m.type === "agent.turn").at(-1)?.payload.id;
  return received.flatMap((m) =>
    m.type === "agent.event" && m.payload.turnId === turnId ? [m.payload.event] : [],
  );
}
