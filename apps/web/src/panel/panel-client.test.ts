import type { Message, PanelDocument, SceneDocument, SceneOp } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { PanelClient, type PanelScene } from "./panel-client.ts";

const doc = (columnX = 0): SceneDocument => ({
  version: 1,
  units: "mm",
  up: "Z",
  name: "Test",
  levels: [{ id: "L0", name: "Ground", elevation: 0 }],
  elements: {
    "c-1": {
      id: "c-1",
      type: "column",
      name: "C1",
      level: "L0",
      position: [columnX, 0],
      section: [400, 400],
      height: 3000,
      properties: {},
    },
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

const moveColumn = (x: number): SceneOp => ({ op: "update", id: "c-1", patch: { position: [x, 0] } });
const document: PanelDocument = { title: "Clearance", width: 320, height: 240, html: "<p>hi</p>" };

function setup() {
  const sent: Message[] = [];
  const applied: Array<{ label: string; ops: SceneOp[] }> = [];
  let snapshot = { doc: doc(), selection: [] as string[] };
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
    runningTurn: () => "turn-1",
    frame: (work) => frames.push(work),
  });
  const problems: string[] = [];
  client.onProblem((m) => problems.push(m));
  /** Draws the next frame: runs what was queued for it. */
  const draw = () => {
    for (const work of frames.splice(0)) work();
  };
  /** The bridge sent a new scene (a patch or a snapshot). */
  const setScene = (next: SceneDocument) => {
    snapshot = { ...snapshot, doc: next };
    for (const l of listeners) l();
  };
  const bridge = (type: string, payload: unknown) => {
    const handled = client.handle({ type, id: "b", payload } as Message);
    expect(handled).toBe(true);
  };
  const offer = (state = "waiting", offerId = "o1") =>
    bridge("panel.offer", { offerId, purpose: "Set the clearance", state, agent: "architect" });
  const open = (panelId = "p1", offerId = "o1") =>
    bridge("panel.open", { panelId, offerId, agent: "architect", ...document });
  const sentOfType = (type: string) => sent.filter((m) => m.type === type).map((m) => m.payload);
  const shown = () => client.shownDoc(snapshot.doc);
  const columnX = (d: SceneDocument | null) => {
    const column = d?.elements["c-1"];
    if (column?.type !== "column") throw new Error("no column");
    return column.position[0];
  };
  return { client, sent, applied, problems, draw, setScene, bridge, offer, open, sentOfType, shown, columnX };
}

/** An accepted offer with a panel that loaded, ready for previews. */
function openPanel() {
  const t = setup();
  t.offer();
  t.client.answer("o1", true);
  t.open();
  t.client.loaded("p1", true);
  return t;
}

describe("PanelClient offers", () => {
  it("an offer card shows its purpose and waits; no panel is open", () => {
    const t = setup();
    t.offer();
    const state = t.client.getSnapshot();
    expect(state.offers).toEqual([
      {
        offerId: "o1",
        purpose: "Set the clearance",
        state: "waiting",
        agent: "architect",
        turnId: "turn-1",
        at: expect.any(Number),
      },
    ]);
    expect(state.panel).toBeNull();
    expect(t.client.waiting).toHaveLength(1);
  });

  it("Open sends the answer and shows the loading frame at once, without waiting for the bridge", () => {
    const t = setup();
    t.offer();
    expect(t.client.answer("o1", true)).toBe(true);
    expect(t.sentOfType("panel.offer.answer")).toEqual([{ offerId: "o1", answer: "accepted" }]);
    const { panel, offers } = t.client.getSnapshot();
    expect(offers[0]?.state).toBe("accepted");
    expect(panel).toMatchObject({ panelId: null, document: null, status: "loading", agent: "architect" });
  });

  it("the bridge echoing the acceptance does not open a second frame", () => {
    const t = setup();
    t.offer();
    t.client.answer("o1", true);
    t.offer("accepted");
    expect(t.client.getSnapshot().panel?.revision).toBe(0);
    expect(t.client.getSnapshot().offers).toHaveLength(1);
  });

  it("another page's acceptance shows the loading frame here too", () => {
    const t = setup();
    t.offer();
    t.offer("accepted");
    expect(t.client.getSnapshot().panel).toMatchObject({ panelId: null, status: "loading" });
  });

  it("Skip tells the agent, shows Skipped and opens nothing", () => {
    const t = setup();
    t.offer();
    t.client.answer("o1", false);
    expect(t.sentOfType("panel.offer.answer")).toEqual([{ offerId: "o1", answer: "skipped" }]);
    expect(t.client.getSnapshot().offers[0]?.state).toBe("skipped");
    expect(t.client.getSnapshot().panel).toBeNull();
  });

  it("an answered offer cannot be answered again", () => {
    const t = setup();
    t.offer();
    t.client.answer("o1", false);
    expect(t.client.answer("o1", true)).toBe(false);
    expect(t.sentOfType("panel.offer.answer")).toHaveLength(1);
  });

  it("an expired offer shows Expired", () => {
    const t = setup();
    t.offer();
    t.offer("expired");
    expect(t.client.getSnapshot().offers[0]?.state).toBe("expired");
    expect(t.client.waiting).toEqual([]);
  });

  it("a turn that ends without the panel removes the loading frame: No panel was made", () => {
    const t = setup();
    t.offer();
    t.client.answer("o1", true);
    expect(t.client.getSnapshot().panel).not.toBeNull();
    t.offer("unused");
    expect(t.client.getSnapshot().panel).toBeNull();
    expect(t.client.getSnapshot().offers[0]?.state).toBe("unused");
  });

  it("a nod answers the only waiting offer, but only while engaged; a shake needs no engagement", () => {
    const t = setup();
    t.offer();
    expect(t.client.answerOnly(true, false)).toBe(false);
    expect(t.client.waiting).toHaveLength(1);
    expect(t.client.answerOnly(true, true)).toBe(true);
    expect(t.client.getSnapshot().offers[0]?.state).toBe("accepted");

    const u = setup();
    u.offer();
    expect(u.client.answerOnly(false, false)).toBe(true);
    expect(u.client.getSnapshot().offers[0]?.state).toBe("skipped");
  });

  it("gestures answer nothing when no offer waits", () => {
    const t = setup();
    expect(t.client.answerOnly(true, true)).toBe(false);
    expect(t.client.answerOnly(false, true)).toBe(false);
  });
});

describe("PanelClient panel lifecycle", () => {
  it("the document replaces the loading state and the frame reports it ready to the agent", () => {
    const t = setup();
    t.offer();
    t.client.answer("o1", true);
    t.open();
    expect(t.client.getSnapshot().panel).toMatchObject({
      panelId: "p1",
      document,
      status: "loading",
      revision: 1,
    });
    t.client.loaded("p1", true);
    expect(t.sentOfType("panel.status")).toEqual([{ panelId: "p1", state: "ready" }]);
    expect(t.client.getSnapshot().panel?.status).toBe("ready");
  });

  it("a failed load is reported with its reason and shown", () => {
    const t = setup();
    t.offer();
    t.client.answer("o1", true);
    t.open();
    t.client.loaded("p1", false, "ReferenceError: x is not defined");
    expect(t.sentOfType("panel.status")).toEqual([
      { panelId: "p1", state: "failed", reason: "ReferenceError: x is not defined" },
    ]);
    expect(t.client.getSnapshot().panel).toMatchObject({
      status: "failed",
      reason: "ReferenceError: x is not defined",
    });
  });

  it("a script error after loading is reported once", () => {
    const t = openPanel();
    t.client.failed("p1", "TypeError: nope");
    t.client.failed("p1", "TypeError: nope");
    expect(
      t.sentOfType("panel.status").filter((s) => (s as { state: string }).state === "failed"),
    ).toHaveLength(1);
  });

  it("an update replaces the document and reloads the frame", () => {
    const t = openPanel();
    t.bridge("panel.update", { panelId: "p1", ...document, title: "Clearance 2" });
    const panel = t.client.getSnapshot().panel;
    expect(panel?.document?.title).toBe("Clearance 2");
    expect(panel?.status).toBe("loading");
    expect(panel?.revision).toBe(2);
  });

  it("an update for another panel is ignored", () => {
    const t = openPanel();
    t.bridge("panel.update", { panelId: "other", ...document, title: "X" });
    expect(t.client.getSnapshot().panel?.document?.title).toBe("Clearance");
  });

  it("the agent closing the panel removes it without telling the bridge", () => {
    const t = openPanel();
    t.bridge("panel.close", { panelId: "p1", reason: "agent" });
    expect(t.client.getSnapshot().panel).toBeNull();
    expect(t.sentOfType("panel.closed")).toEqual([]);
  });

  it("closing the loading frame hides the document that follows", () => {
    const t = setup();
    t.offer();
    t.client.answer("o1", true);
    t.client.close();
    expect(t.client.getSnapshot().panel).toBeNull();
    expect(t.sentOfType("panel.closed")).toEqual([]);
    t.open();
    expect(t.client.getSnapshot().panel).toBeNull();
    expect(t.sentOfType("panel.closed")).toEqual([{ panelId: "p1", outcome: "discarded" }]);
  });

  it("losing the connection closes the panel and puts the model back", () => {
    const t = openPanel();
    t.client.setPreview([moveColumn(500)]);
    t.draw();
    expect(t.columnX(t.shown())).toBe(500);
    t.client.reset();
    expect(t.client.getSnapshot().panel).toBeNull();
    expect(t.columnX(t.shown())).toBe(0);
  });
});

describe("PanelClient previews", () => {
  it("a preview moves the model as the frame is drawn, and the committed scene is untouched", () => {
    const t = openPanel();
    t.client.setPreview([moveColumn(200)]);
    expect(t.columnX(t.shown())).toBe(0); // nothing is shown before the frame
    t.draw();
    expect(t.columnX(t.shown())).toBe(200);
    expect(t.applied).toEqual([]); // nothing went to the bridge: no undo step, no project write
  });

  it("many previews in one frame are shown as one rebuild, the last one", () => {
    const t = openPanel();
    const before = t.client.getSnapshot().previewVersion;
    for (const x of [10, 20, 30, 40]) t.client.setPreview([moveColumn(x)]);
    t.draw();
    expect(t.client.getSnapshot().previewVersion).toBe(before + 1);
    expect(t.columnX(t.shown())).toBe(40);
  });

  it("a later preview replaces the earlier one and an empty one clears it", () => {
    const t = openPanel();
    t.client.setPreview([moveColumn(200)]);
    t.draw();
    t.client.setPreview([{ op: "update", id: "w-1", patch: { height: 2500 } }]);
    t.draw();
    expect(t.columnX(t.shown())).toBe(0);
    t.client.setPreview([]);
    t.draw();
    expect(t.shown()).toBe(t.client.shownDoc(doc()) === null ? null : t.shown());
    expect(t.client.previewing).toBe(false);
  });

  it("an invalid operation changes nothing and the panel is told the element and field", () => {
    const t = openPanel();
    t.client.setPreview([{ op: "update", id: "w-1", patch: { height: 0 } }]);
    t.draw();
    expect(t.problems).toEqual(['Element "w-1": height must be greater than 0']);
    const wall = t.shown()?.elements["w-1"];
    expect(wall?.type === "wall" && wall.height).toBe(3000);
    expect(t.client.previewing).toBe(false);
  });

  it("a preview is laid over each new scene from the bridge", () => {
    const t = openPanel();
    t.client.setPreview([moveColumn(200)]);
    t.draw();
    t.setScene(doc(0)); // an unrelated patch arrives as a new document object
    expect(t.columnX(t.shown())).toBe(200);
  });

  it("a preview whose element was deleted is dropped and reported", () => {
    const t = openPanel();
    t.client.setPreview([moveColumn(200)]);
    t.draw();
    const withoutColumn = doc();
    delete withoutColumn.elements["c-1"];
    t.setScene(withoutColumn);
    expect(t.problems).toEqual(['Element "c-1" does not exist']);
    expect(t.client.previewing).toBe(false);
    expect(t.shown()?.elements["c-1"]).toBeUndefined();
  });

  it("replacing the document discards the uncommitted preview", () => {
    const t = openPanel();
    t.client.setPreview([moveColumn(200)]);
    t.draw();
    t.bridge("panel.update", { panelId: "p1", ...document, html: "<p>new</p>" });
    expect(t.client.previewing).toBe(false);
    expect(t.columnX(t.shown())).toBe(0);
  });

  it("a preview before the document has an id is ignored", () => {
    const t = setup();
    t.offer();
    t.client.answer("o1", true);
    t.client.setPreview([moveColumn(200)]);
    t.draw();
    expect(t.client.previewing).toBe(false);
  });
});

describe("PanelClient commit, Done and Close", () => {
  it("Done sends the preview once, labelled with the panel's title, and closes the panel", () => {
    const t = openPanel();
    t.client.setPreview([moveColumn(200), { op: "update", id: "w-1", patch: { height: 2800 } }]);
    t.draw();
    t.client.done();
    expect(t.applied).toEqual([
      { label: "Clearance", ops: [moveColumn(200), { op: "update", id: "w-1", patch: { height: 2800 } }] },
    ]);
    expect(t.sentOfType("panel.closed")).toEqual([{ panelId: "p1", outcome: "kept" }]);
    expect(t.client.getSnapshot().panel).toBeNull();
    // The model does not flick back while the committed change is on its way.
    expect(t.columnX(t.shown())).toBe(200);
    t.setScene(doc(200));
    expect(t.client.previewing).toBe(false);
    expect(t.columnX(t.shown())).toBe(200);
  });

  it("Close discards the preview, adds no undo step and tells the agent", () => {
    const t = openPanel();
    t.client.setPreview([moveColumn(200)]);
    t.draw();
    t.client.close();
    expect(t.applied).toEqual([]);
    expect(t.sentOfType("panel.closed")).toEqual([{ panelId: "p1", outcome: "discarded" }]);
    expect(t.columnX(t.shown())).toBe(0);
  });

  it("Done with nothing previewed keeps nothing and still closes", () => {
    const t = openPanel();
    t.client.done();
    expect(t.applied).toEqual([]);
    expect(t.sentOfType("panel.closed")).toEqual([{ panelId: "p1", outcome: "kept" }]);
  });

  it("the panel's own commit twice leaves it open with two undo steps", () => {
    const t = openPanel();
    t.client.setPreview([moveColumn(200)]);
    t.draw();
    expect(t.client.commit()).toBe(true);
    t.setScene(doc(200));
    t.client.setPreview([moveColumn(300)]);
    t.draw();
    expect(t.client.commit()).toBe(true);
    expect(t.applied.map((a) => a.label)).toEqual(["Clearance", "Clearance"]);
    expect(t.client.getSnapshot().panel?.panelId).toBe("p1");
  });

  it("a commit with nothing previewed does nothing", () => {
    const t = openPanel();
    expect(t.client.commit()).toBe(false);
    expect(t.applied).toEqual([]);
  });
});

describe("PanelClient information panels", () => {
  /** An accepted offer whose panel the bridge marked read-only (its agent does not change the model). */
  function openInfoPanel() {
    const t = setup();
    t.offer();
    t.client.answer("o1", true);
    t.bridge("panel.open", { panelId: "p1", offerId: "o1", agent: "climate", readOnly: true, ...document });
    t.client.loaded("p1", true);
    return t;
  }

  it("is read-only when the bridge says so", () => {
    const t = openInfoPanel();
    expect(t.client.getSnapshot().panel).toMatchObject({ readOnly: true, agent: "climate" });
  });

  it("refuses a preview: the model is not previewed, the script is told and the bridge hears", () => {
    const t = openInfoPanel();
    t.client.setPreview([moveColumn(200)]);
    t.draw();
    expect(t.columnX(t.shown())).toBe(0);
    expect(t.client.previewing).toBe(false);
    expect(t.problems).toEqual([expect.stringContaining("information only")]);
    expect(t.sentOfType("panel.refused")).toEqual([{ panelId: "p1", attempt: "preview" }]);
  });

  it("refuses a commit and applies nothing", () => {
    const t = openInfoPanel();
    expect(t.client.commit()).toBe(false);
    expect(t.applied).toEqual([]);
    expect(t.sentOfType("panel.refused")).toEqual([{ panelId: "p1", attempt: "commit" }]);
  });

  it("clearing the preview is allowed (it changes nothing)", () => {
    const t = openInfoPanel();
    t.client.setPreview([]);
    expect(t.problems).toEqual([]);
    expect(t.sentOfType("panel.refused")).toEqual([]);
  });

  it("Done only closes it: nothing is applied and the outcome is discarded", () => {
    const t = openInfoPanel();
    t.client.done();
    expect(t.applied).toEqual([]);
    expect(t.sentOfType("panel.closed")).toEqual([{ panelId: "p1", outcome: "discarded" }]);
    expect(t.client.getSnapshot().panel).toBeNull();
  });

  it("a writer's panel is not read-only and still previews and commits", () => {
    const t = openPanel();
    expect(t.client.getSnapshot().panel?.readOnly).toBeUndefined();
    t.client.setPreview([moveColumn(200)]);
    t.draw();
    expect(t.client.commit()).toBe(true);
  });
});
