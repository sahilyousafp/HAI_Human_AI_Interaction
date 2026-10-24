import type { Message, SceneDocument, SceneOp } from "@hai/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PanelClient, type PanelScene } from "./panel-client.ts";
import { PANEL_MAX_ELEMENTS, PanelHost } from "./panel-host.ts";

const column = (id: string, x: number) =>
  ({
    id,
    type: "column",
    name: id,
    level: "L0",
    position: [x, 0],
    section: [400, 400],
    height: 3000,
    properties: {},
  }) as const;

const makeDoc = (columns = 2): SceneDocument => ({
  version: 1,
  units: "mm",
  up: "Z",
  name: "Test",
  levels: [{ id: "L0", name: "Ground", elevation: 0 }],
  elements: {
    ...Object.fromEntries(Array.from({ length: columns }, (_, i) => [`c-${i}`, column(`c-${i}`, i * 1000)])),
    "w-1": {
      id: "w-1",
      type: "wall",
      name: "W1",
      level: "L0",
      start: [0, 0],
      end: [5000, 0],
      height: 3000,
      thickness: 200,
      properties: {},
    },
  },
});

const channels: MessageChannel[] = [];
afterEach(() => {
  for (const channel of channels.splice(0)) {
    channel.port1.close();
    channel.port2.close();
  }
});

function setup(columns = 2, loadTimeoutMs = 60_000) {
  const sent: Message[] = [];
  const applied: Array<{ label: string; ops: SceneOp[] }> = [];
  let snapshot = { doc: makeDoc(columns), selection: [] as string[] };
  const listeners = new Set<() => void>();
  const scene: PanelScene = {
    getSnapshot: () => snapshot,
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    apply: (label, ops) => {
      applied.push({ label, ops });
      return true;
    },
  };
  const frames: Array<() => void> = [];
  const client = new PanelClient({
    send: (m) => {
      sent.push(m);
      return true;
    },
    scene,
    runningTurn: () => null,
    frame: (work) => frames.push(work),
  });
  client.handle({
    type: "panel.offer",
    id: "b",
    payload: { offerId: "o1", purpose: "Clearance", state: "waiting" },
  });
  client.answer("o1", true);
  client.handle({
    type: "panel.open",
    id: "b",
    payload: { panelId: "p1", offerId: "o1", title: "Clearance", width: 320, height: 240, html: "<p>hi</p>" },
  });
  const channel = new MessageChannel();
  channels.push(channel);
  let clock = 0;
  const host = new PanelHost({
    port: channel.port1,
    panelId: "p1",
    client,
    scene,
    now: () => clock,
    loadTimeoutMs,
  });
  /** What the panel's script receives. */
  const received: Array<Record<string, unknown>> = [];
  channel.port2.onmessage = (event) => received.push(event.data as Record<string, unknown>);
  /** The panel's script sends to the page. */
  const fromPanel = (message: unknown) => channel.port2.postMessage(message);
  const draw = () => {
    for (const work of frames.splice(0)) work();
  };
  const statuses = () => sent.filter((m) => m.type === "panel.status").map((m) => m.payload);
  return {
    host,
    client,
    received,
    fromPanel,
    draw,
    statuses,
    sent,
    applied,
    advance: (ms: number) => {
      clock += ms;
    },
    changeScene: (next: Partial<typeof snapshot>) => {
      snapshot = { ...snapshot, ...next };
      for (const l of listeners) l();
    },
    ofType: (type: string) => received.filter((m) => m.type === type),
  };
}

describe("PanelHost loading", () => {
  it("the panel reporting ready tells the agent the document loaded", async () => {
    const t = setup();
    t.fromPanel({ type: "ready" });
    await vi.waitFor(() => expect(t.statuses()).toEqual([{ panelId: "p1", state: "ready" }]));
  });

  it("a script error before ready fails the load with the error, once", async () => {
    const t = setup();
    t.fromPanel({ type: "error", message: "ReferenceError: x is not defined" });
    t.fromPanel({ type: "ready" });
    await vi.waitFor(() => expect(t.statuses()).toHaveLength(1));
    expect(t.statuses()[0]).toEqual({
      panelId: "p1",
      state: "failed",
      reason: "ReferenceError: x is not defined",
    });
    expect(t.client.getSnapshot().panel?.status).toBe("failed");
  });

  it("a script error after ready is shown and reported", async () => {
    const t = setup();
    t.fromPanel({ type: "ready" });
    t.fromPanel({ type: "error", message: "TypeError: nope" });
    await vi.waitFor(() => expect(t.statuses()).toHaveLength(2));
    expect(t.statuses()[1]).toMatchObject({ state: "failed", reason: "TypeError: nope" });
    expect(t.client.getSnapshot().panel?.status).toBe("failed");
  });

  it("a document that never reports is failed after the load timeout", () => {
    vi.useFakeTimers();
    try {
      const t = setup(2, 8000);
      vi.advanceTimersByTime(8000);
      expect(t.statuses()).toEqual([
        { panelId: "p1", state: "failed", reason: "The panel did not finish loading." },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("PanelHost reading the scene", () => {
  const get = async (t: ReturnType<typeof setup>, query: unknown) => {
    t.fromPanel({ type: "get", requestId: "r1", query });
    await vi.waitFor(() => expect(t.ofType("reply")).toHaveLength(1));
    return t.ofType("reply")[0]?.result as {
      elements: Array<{ id: string }>;
      notFound?: string[];
      truncated?: boolean;
    };
  };

  it("Panel reads the scene: elements of a type, with their ids and properties", async () => {
    const t = setup(3);
    const result = await get(t, { type: "column" });
    expect(result.elements.map((e) => e.id)).toEqual(["c-0", "c-1", "c-2"]);
    expect(result.elements[0]).toMatchObject({ type: "column", position: [0, 0], section: [400, 400] });
    expect(t.ofType("reply")[0]?.requestId).toBe("r1");
  });

  it("by ids, and reports the ids it did not find", async () => {
    const t = setup();
    const result = await get(t, { ids: ["c-1", "nope"] });
    expect(result.elements.map((e) => e.id)).toEqual(["c-1"]);
    expect(result.notFound).toEqual(["nope"]);
  });

  it("returns at most 200 elements and says it was cut", async () => {
    const t = setup(250);
    const result = await get(t, { type: "column" });
    expect(result.elements).toHaveLength(PANEL_MAX_ELEMENTS);
    expect(result.truncated).toBe(true);
  });

  it("the panel sees its own preview over the committed scene", async () => {
    const t = setup();
    t.fromPanel({ type: "ready" });
    t.fromPanel({ type: "preview", ops: [{ op: "update", id: "c-0", patch: { position: [900, 0] } }] });
    await vi.waitFor(() => expect(t.client.previewing).toBe(true));
    t.draw();
    const result = await get(t, { ids: ["c-0"] });
    expect(result.elements[0]).toMatchObject({ position: [900, 0] });
  });
});

describe("PanelHost what a panel may send", () => {
  it("a preview reaches the client; a commit sends it as one transaction labelled with the title", async () => {
    const t = setup();
    t.fromPanel({ type: "preview", ops: [{ op: "update", id: "c-0", patch: { position: [900, 0] } }] });
    await vi.waitFor(() => expect(t.client.previewing).toBe(true));
    t.fromPanel({ type: "commit" });
    await vi.waitFor(() => expect(t.applied).toHaveLength(1));
    expect(t.applied[0]).toEqual({
      label: "Clearance",
      ops: [{ op: "update", id: "c-0", patch: { position: [900, 0] } }],
    });
  });

  it("an unknown message is refused and changes nothing", async () => {
    const t = setup();
    t.fromPanel({ type: "navigate", url: "https://example.com" });
    await vi.waitFor(() => expect(t.ofType("problem")).toHaveLength(1));
    expect(String(t.ofType("problem")[0]?.message)).toMatch(/Invalid message/);
    expect(t.client.previewing).toBe(false);
    expect(t.applied).toEqual([]);
  });

  it("Invalid operation: a malformed operation is refused and the panel is told", async () => {
    const t = setup();
    t.fromPanel({ type: "preview", ops: [{ op: "format-disk" }] });
    await vi.waitFor(() => expect(t.ofType("problem")).toHaveLength(1));
    expect(t.client.previewing).toBe(false);
  });

  it("Invalid operation: a wall of height zero changes nothing and the panel is told which wall and field", async () => {
    const t = setup();
    t.fromPanel({ type: "preview", ops: [{ op: "update", id: "w-1", patch: { height: 0 } }] });
    await vi.waitFor(() => expect(t.client.previewing).toBe(true));
    t.draw();
    await vi.waitFor(() => expect(t.ofType("problem")).toHaveLength(1));
    expect(t.ofType("problem")[0]?.message).toBe('Element "w-1": height must be greater than 0');
    expect(t.client.shownDoc(makeDoc())?.elements["w-1"]).toMatchObject({ height: 3000 });
    expect(t.applied).toEqual([]);
  });

  it("Flooding is limited: of 200 messages in one second, no more than 60 are accepted and the panel is told", async () => {
    const t = setup();
    let previews = 0;
    t.client.setPreview = () => {
      previews += 1;
    };
    for (let i = 0; i < 200; i++) t.fromPanel({ type: "preview", ops: [] });
    await vi.waitFor(() => expect(t.ofType("problem")).toHaveLength(1));
    await vi.waitFor(() => expect(previews).toBe(60));
    expect(String(t.ofType("problem")[0]?.message)).toMatch(/60 per second/);
  });

  it("a burst at load does not stop the panel from reporting that it is ready, or that it failed", async () => {
    const t = setup();
    for (let i = 0; i < 100; i++) t.fromPanel({ type: "preview", ops: [] });
    t.fromPanel({ type: "ready" });
    await vi.waitFor(() => expect(t.statuses()).toEqual([{ panelId: "p1", state: "ready" }]));
    t.fromPanel({ type: "error", message: "late" });
    await vi.waitFor(() => expect(t.statuses()).toHaveLength(2));
  });

  it("the limit resets each second", async () => {
    const t = setup();
    let previews = 0;
    t.client.setPreview = () => {
      previews += 1;
    };
    for (let i = 0; i < 100; i++) t.fromPanel({ type: "preview", ops: [] });
    await vi.waitFor(() => expect(previews).toBe(60));
    t.advance(1001);
    for (let i = 0; i < 10; i++) t.fromPanel({ type: "preview", ops: [] });
    await vi.waitFor(() => expect(previews).toBe(70));
  });

  it("Escape closes the panel and discards the preview", async () => {
    const t = setup();
    t.fromPanel({ type: "ready" });
    t.fromPanel({ type: "key", key: "Escape" });
    await vi.waitFor(() => expect(t.client.getSnapshot().panel).toBeNull());
    expect(t.sent.some((m) => m.type === "panel.closed" && m.payload.outcome === "discarded")).toBe(true);
  });
});

describe("PanelHost what the panel is told", () => {
  it("the selection arrives at once and again when it changes", async () => {
    const t = setup();
    await vi.waitFor(() => expect(t.ofType("selection")).toHaveLength(1));
    expect(t.ofType("selection")[0]?.ids).toEqual([]);
    t.changeScene({ selection: ["c-0"] });
    await vi.waitFor(() => expect(t.ofType("selection")).toHaveLength(2));
    expect(t.ofType("selection")[1]?.ids).toEqual(["c-0"]);
  });

  it("a scene change after a patch arrives as a scene event, a selection-only change does not", async () => {
    const t = setup();
    t.changeScene({ selection: ["c-1"] });
    await vi.waitFor(() => expect(t.ofType("selection")).toHaveLength(2));
    expect(t.ofType("scene")).toHaveLength(0);
    t.changeScene({ doc: makeDoc(5) });
    await vi.waitFor(() => expect(t.ofType("scene")).toHaveLength(1));
  });

  it("the theme is sent with its tokens", async () => {
    const t = setup();
    t.host.setTheme({ scheme: "dark", vars: { "--panel": "#1c1c1e" } });
    await vi.waitFor(() => expect(t.ofType("theme")).toHaveLength(1));
    expect(t.ofType("theme")[0]).toMatchObject({ scheme: "dark", vars: { "--panel": "#1c1c1e" } });
  });

  it("a hand press is forwarded in frame coordinates", async () => {
    const t = setup();
    t.host.press("down", 40, 30);
    await vi.waitFor(() => expect(t.ofType("press")).toHaveLength(1));
    expect(t.ofType("press")[0]).toEqual({ type: "press", phase: "down", x: 40, y: 30 });
  });

  it("nothing is received after the host is disposed", async () => {
    const t = setup();
    t.host.dispose();
    t.fromPanel({ type: "ready" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(t.statuses()).toEqual([]);
  });
});
