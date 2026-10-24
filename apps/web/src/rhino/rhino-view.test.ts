import { describe, expect, it } from "vitest";
import type { MirrorState } from "./rhino-mirror.ts";
import { connectionText, notDrawnText, pythonText, rhinoPill, syncText } from "./rhino-view.ts";

const none = { curves: 0, points: 0, annotations: 0, other: 0, heavy: 0 };
const state = (partial: Partial<MirrorState>): MirrorState => ({
  connected: false,
  mode: "auto",
  inUse: "python",
  python: null,
  document: null,
  objects: [],
  notDrawn: none,
  sync: null,
  selection: [],
  version: 0,
  synced: 0,
  ...partial,
});

describe("notDrawnText", () => {
  it("says nothing when everything is drawn", () => {
    expect(notDrawnText(none)).toBeNull();
  });

  it("names what is left out, with the right plurals", () => {
    expect(notDrawnText({ ...none, curves: 12 })).toBe("12 curves not drawn");
    expect(notDrawnText({ ...none, curves: 1, annotations: 1 })).toBe("1 curve and 1 annotation not drawn");
    expect(notDrawnText({ ...none, curves: 12, points: 3, annotations: 1 })).toBe(
      "12 curves, 3 points and 1 annotation not drawn",
    );
  });

  it("explains an object drawn as its box", () => {
    expect(notDrawnText({ ...none, heavy: 1 })).toBe("1 object too heavy to draw in full (drawn as a box)");
    expect(notDrawnText({ ...none, curves: 2, heavy: 3 })).toBe(
      "2 curves not drawn; 3 objects too heavy to draw in full (drawn as boxes)",
    );
  });
});

describe("status words", () => {
  it("progress of the first sync", () => {
    expect(syncText({ done: 120, total: 4000 })).toBe("Syncing 120 of 4000");
    expect(syncText(null)).toBeNull();
  });

  it("the connection, with what to do when it is not there", () => {
    expect(connectionText({ connected: false, document: null })).toBe(
      "Not connected. Run HaiConnect in Rhino.",
    );
    expect(connectionText({ connected: true, document: "tower.3dm" })).toBe("Connected to tower.3dm");
    expect(connectionText({ connected: true, document: null })).toMatch(/unsaved/);
  });

  it("Python in Rhino: ready, or why not and how to fix it", () => {
    expect(pythonText({ state: "ready" })).toBe("Python ready");
    expect(pythonText({ state: "unavailable", reason: "no engine" })).toMatch(
      /Python not available in Rhino: no engine\..*run HaiConnect again/,
    );
    expect(pythonText(null)).toBeNull();
  });
});

describe("rhinoPill", () => {
  it("is absent when Rhino is not there and the mode is Automatic", () => {
    expect(rhinoPill(state({}))).toBeNull();
  });

  it("shows Rhino connected, then the sync, when it is there", () => {
    expect(rhinoPill(state({ connected: true, inUse: "rhino" }))).toEqual({
      text: "Rhino connected",
      tone: "on",
    });
    expect(rhinoPill(state({ connected: true, inUse: "rhino", sync: { done: 5, total: 50 } }))).toEqual({
      text: "Syncing 5 of 50",
      tone: "busy",
    });
  });

  it("says so when the user chose Rhino and it is not there, or chose Python only", () => {
    expect(rhinoPill(state({ mode: "rhino", inUse: "rhino" }))).toEqual({
      text: "Rhino not connected",
      tone: "off",
    });
    expect(rhinoPill(state({ mode: "python", connected: true }))).toEqual({
      text: "Python only",
      tone: "off",
    });
  });
});
