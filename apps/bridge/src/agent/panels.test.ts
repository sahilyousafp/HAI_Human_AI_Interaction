import type { Message, PanelDocument } from "@hai/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PanelBroker, type PanelClosure } from "./panels.ts";

const doc: PanelDocument = { title: "Clearance", width: 320, height: 240, html: "<p>hi</p>" };

function setup() {
  const sent: Message[] = [];
  const closures: PanelClosure[] = [];
  const broker = new PanelBroker({ closed: (c) => closures.push(c) }, (m) => sent.push(m));
  const ofType = (type: string) => sent.filter((m) => m.type === type);
  const offerStates = () => ofType("panel.offer").map((m) => (m.payload as { state: string }).state);
  const lastOffer = () => ofType("panel.offer").at(-1)?.payload as { offerId: string; state: string };
  const answer = (value: "accepted" | "skipped") =>
    broker.handle({
      type: "panel.offer.answer",
      id: "a",
      payload: { offerId: lastOffer().offerId, answer: value },
    });
  const panelId = () => (ofType("panel.open")[0]?.payload as { panelId?: string } | undefined)?.panelId ?? "";
  const status = (state: "ready" | "failed", reason?: string) =>
    broker.handle({
      type: "panel.status",
      id: "s",
      payload: { panelId: panelId(), state, ...(reason ? { reason } : {}) },
    });
  const closed = (outcome: "kept" | "discarded") =>
    broker.handle({ type: "panel.closed", id: "c", payload: { panelId: panelId(), outcome } });
  /** Offers, accepts and opens a panel for an agent, and reports it loaded. */
  const openPanel = async (agent: string | null = "architect") => {
    const offer = broker.offer(agent, "Set the clearance");
    answer("accepted");
    await offer;
    const opened = broker.open(agent, doc);
    status("ready");
    expect(await opened).toEqual({ ok: true });
  };
  return {
    broker,
    sent,
    closures,
    ofType,
    offerStates,
    lastOffer,
    answer,
    panelId,
    status,
    closed,
    openPanel,
  };
}

describe("PanelBroker offers", () => {
  it("an offer is shown with its purpose and waits for the user", async () => {
    const { broker, sent, lastOffer } = setup();
    void broker.offer("architect", "Set the wall to column clearance");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: "panel.offer",
      payload: { purpose: "Set the wall to column clearance", state: "waiting", agent: "architect" },
    });
    expect(lastOffer().offerId).toBeTruthy();
    expect(broker.stateOf("architect")).toBe("waiting");
  });

  it("accepting moves none -> waiting -> accepted and tells the agent", async () => {
    const { broker, answer, offerStates } = setup();
    expect(broker.stateOf("architect")).toBe("none");
    const offer = broker.offer("architect", "Tolerance");
    answer("accepted");
    expect(await offer).toEqual({ ok: true, answer: "accepted" });
    expect(broker.stateOf("architect")).toBe("accepted");
    expect(offerStates()).toEqual(["waiting", "accepted"]);
  });

  it("skipping tells the agent and frees the slot", async () => {
    const { broker, answer, offerStates } = setup();
    const offer = broker.offer("architect", "Tolerance");
    answer("skipped");
    expect(await offer).toEqual({ ok: true, answer: "skipped" });
    expect(broker.stateOf("architect")).toBe("none");
    expect(offerStates()).toEqual(["waiting", "skipped"]);
    expect(broker.active).toBe(false);
  });

  it("an offer nobody answers expires after a minute", async () => {
    vi.useFakeTimers();
    try {
      const { broker, offerStates } = setup();
      const offer = broker.offer("architect", "Tolerance");
      vi.advanceTimersByTime(59_999);
      expect(broker.stateOf("architect")).toBe("waiting");
      vi.advanceTimersByTime(1);
      expect(await offer).toEqual({ ok: true, answer: "expired" });
      expect(offerStates()).toEqual(["waiting", "expired"]);
      expect(broker.active).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("an answer after the offer expired changes nothing", async () => {
    vi.useFakeTimers();
    try {
      const { broker, answer, offerStates } = setup();
      void broker.offer("architect", "Tolerance");
      vi.advanceTimersByTime(60_000);
      answer("accepted");
      expect(broker.stateOf("architect")).toBe("none");
      expect(offerStates()).toEqual(["waiting", "expired"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("an answer for another offer is ignored", () => {
    const { broker, sent } = setup();
    void broker.offer("architect", "Tolerance");
    broker.handle({ type: "panel.offer.answer", id: "a", payload: { offerId: "other", answer: "accepted" } });
    expect(broker.stateOf("architect")).toBe("waiting");
    expect(sent).toHaveLength(1);
  });

  it("an offer while another is waiting is refused, across agents", async () => {
    const { broker } = setup();
    void broker.offer("architect", "Tolerance");
    const refused = await broker.offer("product", "Another");
    expect(refused).toMatchObject({ ok: false });
    expect(refused.ok === false && refused.error).toMatch(/already waiting/);
    expect(broker.stateOf("product")).toBe("none");
  });

  it("offer while open is refused with an error that a panel is open", async () => {
    const { broker, openPanel } = setup();
    await openPanel();
    const refused = await broker.offer("architect", "Again");
    expect(refused.ok === false && refused.error).toMatch(/panel is already open/);
    const other = await broker.offer("product", "Mine");
    expect(other.ok === false && other.error).toMatch(/panel is already open/);
  });
});

describe("PanelBroker supplying a panel", () => {
  it("panel without an accepted offer is refused and tells the agent to offer first", async () => {
    const { broker, ofType } = setup();
    const result = await broker.open("architect", doc);
    expect(result.ok === false && result.error).toMatch(/not accepted a panel.*offer_panel/);
    expect(ofType("panel.open")).toHaveLength(0);
  });

  it("a skipped offer does not allow a panel", async () => {
    const { broker, answer, ofType } = setup();
    const offer = broker.offer("architect", "Tolerance");
    answer("skipped");
    await offer;
    expect((await broker.open("architect", doc)).ok).toBe(false);
    expect(ofType("panel.open")).toHaveLength(0);
  });

  it("another agent cannot use this agent's accepted offer", async () => {
    const { broker, answer, ofType } = setup();
    const offer = broker.offer("architect", "Tolerance");
    answer("accepted");
    await offer;
    expect((await broker.open("product", doc)).ok).toBe(false);
    expect(ofType("panel.open")).toHaveLength(0);
    expect(broker.stateOf("architect")).toBe("accepted");
  });

  it("an accepted offer opens the panel, and open_panel resolves when the page reports ready", async () => {
    const { broker, answer, ofType, status } = setup();
    const offer = broker.offer("architect", "Tolerance");
    answer("accepted");
    await offer;
    let settled = false;
    const opened = broker.open("architect", doc).then((r) => {
      settled = true;
      return r;
    });
    expect(ofType("panel.open")[0]?.payload).toMatchObject({ ...doc, agent: "architect" });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(broker.stateOf("architect")).toBe("open");
    status("ready");
    expect(await opened).toEqual({ ok: true });
  });

  it("a document that fails to load fails the call with the page's reason, and the panel stays open", async () => {
    const { broker, answer, status } = setup();
    const offer = broker.offer("architect", "Tolerance");
    answer("accepted");
    await offer;
    const opened = broker.open("architect", doc);
    status("failed", "ReferenceError: x is not defined");
    expect(await opened).toEqual({ ok: false, error: "ReferenceError: x is not defined" });
    expect(broker.stateOf("architect")).toBe("open");
  });

  it("when no page reports the load, the call fails after the load timeout", async () => {
    vi.useFakeTimers();
    try {
      const { broker, answer } = setup();
      const offer = broker.offer("architect", "Tolerance");
      answer("accepted");
      await offer;
      const opened = broker.open("architect", doc);
      vi.advanceTimersByTime(10_000);
      expect(await opened).toEqual({ ok: false, error: "The page did not report the panel as loaded." });
    } finally {
      vi.useRealTimers();
    }
  });

  it("second panel is refused: one offer allows exactly one panel", async () => {
    const { broker, openPanel, ofType } = setup();
    await openPanel();
    const second = await broker.open("architect", doc);
    expect(second.ok === false && second.error).toMatch(/already open/);
    expect(ofType("panel.open")).toHaveLength(1);
  });

  it("acceptance is used once: after the panel closes a new panel needs a new offer", async () => {
    const { broker, openPanel, closed, ofType } = setup();
    await openPanel();
    closed("kept");
    expect((await broker.open("architect", doc)).ok).toBe(false);
    expect(ofType("panel.open")).toHaveLength(1);
    expect(broker.stateOf("architect")).toBe("none");
  });

  it("update replaces the open panel's document and needs no new offer", async () => {
    const { broker, openPanel, ofType, panelId, status } = setup();
    await openPanel();
    const updated = broker.update("architect", { ...doc, title: "Clearance 2" });
    expect(ofType("panel.update")[0]?.payload).toMatchObject({ panelId: panelId(), title: "Clearance 2" });
    status("ready");
    expect(await updated).toEqual({ ok: true });
  });

  it("update without an open panel, or from another agent, is refused", async () => {
    const { broker, openPanel } = setup();
    expect((await broker.update("architect", doc)).ok).toBe(false);
    await openPanel();
    expect((await broker.update("product", doc)).ok).toBe(false);
  });
});

describe("PanelBroker closing", () => {
  it("the user closing it reports the outcome to the agent that opened it", async () => {
    const { broker, openPanel, closed, closures } = setup();
    await openPanel();
    closed("kept");
    expect(closures).toEqual([{ agent: "architect", title: "Clearance", outcome: "kept", by: "user" }]);
    expect(broker.stateOf("architect")).toBe("none");
    expect(broker.active).toBe(false);
  });

  it("the agent closing it tells the page and discards", async () => {
    const { broker, openPanel, ofType, panelId, closures } = setup();
    await openPanel();
    expect(broker.close("architect")).toEqual({ ok: true });
    expect(ofType("panel.close")[0]?.payload).toEqual({ panelId: panelId(), reason: "agent" });
    expect(closures[0]).toMatchObject({ outcome: "discarded", by: "agent" });
    expect(broker.close("architect").ok).toBe(false);
  });

  it("only the opener can close the panel", async () => {
    const { broker, openPanel } = setup();
    await openPanel("architect");
    expect(broker.close("product").ok).toBe(false);
    expect(broker.stateOf("architect")).toBe("open");
  });

  it("a close for a panel that is not the open one is ignored", async () => {
    const { broker, openPanel, closures } = setup();
    await openPanel();
    broker.handle({ type: "panel.closed", id: "c", payload: { panelId: "stale", outcome: "kept" } });
    expect(closures).toEqual([]);
    expect(broker.stateOf("architect")).toBe("open");
  });

  it("closing while the document still loads fails the pending open_panel call", async () => {
    const { broker, answer, closed } = setup();
    const offer = broker.offer("architect", "Tolerance");
    answer("accepted");
    await offer;
    const opened = broker.open("architect", doc);
    closed("discarded");
    expect((await opened).ok).toBe(false);
  });

  it("losing every page closes the panel and discards", async () => {
    const { broker, openPanel, closures } = setup();
    await openPanel();
    broker.clientsGone();
    expect(closures[0]).toMatchObject({ outcome: "discarded", by: "system" });
    expect(broker.active).toBe(false);
  });

  it("switching the feature off sends close, discards, and withdraws a waiting offer", async () => {
    const first = setup();
    await first.openPanel();
    first.broker.switchedOff();
    expect(first.ofType("panel.close")[0]?.payload).toMatchObject({ reason: "switched-off" });
    expect(first.closures[0]).toMatchObject({ outcome: "discarded", by: "system" });

    const second = setup();
    const offer = second.broker.offer("architect", "Tolerance");
    second.broker.switchedOff();
    expect(await offer).toEqual({ ok: true, answer: "expired" });
    expect(second.offerStates()).toEqual(["waiting", "unused"]);
  });
});

describe("PanelBroker turns", () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });
  it("a stopped turn ends a waiting offer: the card shows no panel was made", async () => {
    const offer = t.broker.offer("architect", "Tolerance");
    t.broker.turnEnded("architect");
    expect(await offer).toEqual({ ok: true, answer: "expired" });
    expect(t.offerStates()).toEqual(["waiting", "unused"]);
    expect(t.broker.active).toBe(false);
  });

  it("a turn that ends after acceptance without a panel leaves 'No panel was made'", async () => {
    const offer = t.broker.offer("architect", "Tolerance");
    t.answer("accepted");
    await offer;
    t.broker.turnEnded("architect");
    expect(t.offerStates()).toEqual(["waiting", "accepted", "unused"]);
    expect(t.broker.stateOf("architect")).toBe("none");
  });

  it("the end of another agent's turn changes nothing", async () => {
    void t.broker.offer("architect", "Tolerance");
    t.broker.turnEnded("product");
    expect(t.broker.stateOf("architect")).toBe("waiting");
  });

  it("an open panel outlives the turn that made it", async () => {
    await t.openPanel();
    t.broker.turnEnded("architect");
    expect(t.broker.stateOf("architect")).toBe("open");
    expect(t.closures).toEqual([]);
  });

  it("a page that connects later is told what is waiting or open", async () => {
    void t.broker.offer("architect", "Tolerance");
    const late: Message[] = [];
    t.broker.greet((m) => late.push(m));
    expect(late[0]).toMatchObject({ type: "panel.offer", payload: { state: "waiting" } });

    const open = setup();
    await open.openPanel();
    const lateOpen: Message[] = [];
    open.broker.greet((m) => lateOpen.push(m));
    expect(lateOpen[0]).toMatchObject({ type: "panel.open", payload: { title: "Clearance" } });
  });
});
