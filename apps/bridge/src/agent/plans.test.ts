import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "@hai/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { fakeProvider } from "../../test/fake-provider.ts";
import { connectClient } from "../../test/ws-client.ts";
import { type Bridge, createBridge } from "../server.ts";
import { PlanBroker } from "./plans.ts";
import type { Team } from "./team.ts";

const parts = [
  { agent: "architect", title: "Dome", scope: { part: "dome" } },
  { agent: "architect", title: "Minarets", scope: { part: "minarets" } },
  { agent: "product", title: "Garden" },
];

function broker(timeoutMs?: number) {
  const sent: Message[] = [];
  const plans = new PlanBroker({ ...(timeoutMs ? { timeoutMs } : {}) }, (m) => sent.push(m));
  const pending = () => sent.find((m) => m.type === "plan.pending");
  const answer = (keep: string[] | null) => {
    const shown = pending();
    if (shown?.type !== "plan.pending") throw new Error("no plan shown");
    plans.handle({ type: "plan.answer", id: "a", payload: { id: shown.payload.id, keep } });
  };
  const ids = () =>
    (pending()?.type === "plan.pending" ? pending()?.payload.parts.map((p) => p.id) : []) ?? [];
  return { plans, sent, pending, answer, ids };
}

describe("the plan", () => {
  it("is shown with each part and its agent, and the parts the user keeps come back", async () => {
    const { plans, sent, answer, ids } = broker();
    const asked = plans.ask("mochi", parts);
    const shown = sent[0];
    expect(shown).toMatchObject({ type: "plan.pending", payload: { agent: "mochi" } });
    expect(shown?.type === "plan.pending" && shown.payload.parts.map((p) => [p.agent, p.title])).toEqual([
      ["architect", "Dome"],
      ["architect", "Minarets"],
      ["product", "Garden"],
    ]);
    // The user removes "Garden" and confirms.
    answer((ids() as string[]).slice(0, 2));
    const result = await asked;
    expect(result.outcome).toBe("confirmed");
    expect(result.keep.map((p) => p.title)).toEqual(["Dome", "Minarets"]);
    expect(sent.at(-1)).toMatchObject({ type: "plan.resolved", payload: { outcome: "confirmed" } });
    expect(plans.waiting).toBe(false);
  });

  it("skipping, or keeping nothing, hands nothing out", async () => {
    const skip = broker();
    const one = skip.plans.ask("mochi", parts);
    skip.answer(null);
    expect(await one).toEqual({ outcome: "skipped", keep: [] });
    const none = broker();
    const two = none.plans.ask("mochi", parts);
    none.answer([]);
    expect((await two).outcome).toBe("skipped");
  });

  it("ids it did not show are ignored", async () => {
    const { plans, answer } = broker();
    const asked = plans.ask("mochi", parts);
    answer(["not-a-part"]);
    expect((await asked).outcome).toBe("skipped");
  });

  it("an unanswered plan expires, and so does one whose turn ends or whose pages are gone", async () => {
    vi.useFakeTimers();
    try {
      const timed = broker(1000);
      const one = timed.plans.ask("mochi", parts);
      await vi.advanceTimersByTimeAsync(1001);
      expect(await one).toEqual({ outcome: "expired", keep: [] });
      const ended = broker();
      const two = ended.plans.ask("mochi", parts);
      ended.plans.turnEnded("architect"); // another agent's turn: the plan stays
      expect(ended.plans.waiting).toBe(true);
      ended.plans.turnEnded("mochi");
      expect((await two).outcome).toBe("expired");
      const gone = broker();
      const three = gone.plans.ask("mochi", parts);
      gone.plans.clientsGone();
      expect((await three).outcome).toBe("expired");
    } finally {
      vi.useRealTimers();
    }
  });

  it("only one plan is open: a second is not shown", async () => {
    const { plans, sent } = broker();
    void plans.ask("mochi", parts);
    expect(await plans.ask("mochi", parts)).toEqual({ outcome: "expired", keep: [] });
    expect(sent.filter((m) => m.type === "plan.pending")).toHaveLength(1);
  });

  it("a page that connects later is shown the plan that waits", () => {
    const { plans } = broker();
    void plans.ask("mochi", parts);
    const late: Message[] = [];
    plans.greet((m) => late.push(m));
    expect(late[0]?.type).toBe("plan.pending");
  });
});

describe("Mochi's plan, end to end with the fake agent", () => {
  const ORIGIN = "http://localhost:5173";
  const TOKEN = "plans-test-token-0123456789";
  let bridge: Bridge | null = null;
  const sockets: WebSocket[] = [];
  afterEach(async () => {
    await (bridge?.agent as Team | null)?.stopAll();
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
      scene: { projectDir: join(mkdtempSync(join(tmpdir(), "hai-plans-")), "project"), saveDelayMs: 50 },
      agent: { provider: fakeProvider(mkdtempSync(join(tmpdir(), "hai-fake-state-"))) },
    });
    const address: AddressInfo = await bridge.start();
    const team = bridge.agent as Team;
    await team.ready;
    const viewer = await connectClient(address, { token: TOKEN, origin: ORIGIN, track: sockets });
    return { team, viewer };
  }

  it("the user removes a part and confirms: only the two that are kept are handed out", async () => {
    const { team, viewer } = await start();
    const turn = team.request(
      "plan architect[dome]: Dome ;; architect[minarets]: Minarets ;; product[garden]: Garden",
    );
    const shown = await viewer.waitFor("plan.pending");
    expect(shown.payload.parts.map((p) => p.title)).toEqual(["Dome", "Minarets", "Garden"]);
    // Nothing is handed out before the user answers.
    expect(team.board).toHaveLength(0);
    const keep = shown.payload.parts.filter((p) => p.title !== "Garden").map((p) => p.id);
    viewer.send("plan.answer", { id: shown.payload.id, keep });
    await turn;
    await team.settled();
    expect(team.board.map((t) => t.agent).sort()).toEqual(["architect", "architect"]);
    expect(team.board.map((t) => t.title).sort()).toEqual(["Dome", "Minarets"]);
    expect(team.board.find((t) => t.title === "Dome")?.scope).toEqual({ part: "dome" });
    const resolved = await viewer.waitFor("plan.resolved");
    expect(resolved.payload).toMatchObject({ outcome: "confirmed", keep });
  });

  it("skipping the plan hands nothing out", async () => {
    const { team, viewer } = await start();
    const turn = team.request("plan architect[dome]: Dome ;; product[garden]: Garden");
    const shown = await viewer.waitFor("plan.pending");
    viewer.send("plan.answer", { id: shown.payload.id, keep: null });
    await turn;
    await team.settled();
    expect(team.board).toHaveLength(0);
  });

  it("a part for an agent that is not on the team is refused before the user sees anything", async () => {
    const { team, viewer } = await start();
    await team.request("plan nobody[dome]: Dome");
    expect(viewer.received.some((m) => m.type === "plan.pending")).toBe(false);
  });
});
