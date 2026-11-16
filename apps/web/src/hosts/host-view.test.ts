import { describe, expect, it } from "vitest";
import type { MirrorStatus } from "./host-mirror.ts";
import { connectionText, hostChip, notDrawnText, runText, syncText } from "./host-view.ts";

const none = { curves: 0, points: 0, annotations: 0, other: 0, heavy: 0, simplified: 0 };
const state = (partial: Partial<MirrorStatus>): MirrorStatus => ({
  switchedOn: true,
  connected: false,
  app: null,
  run: null,
  capabilities: null,
  document: null,
  notDrawn: none,
  sync: null,
  ...partial,
});
const rhino = { name: "Rhino 8", version: "8.36.0" };

describe("notDrawnText", () => {
  it("says nothing when everything is drawn", () => {
    expect(notDrawnText(none)).toBeNull();
  });

  it("curves are counted: it names what is left out, with the right plurals", () => {
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

  it("says when blocks are drawn with less detail", () => {
    expect(notDrawnText({ ...none, simplified: 2430 })).toBe(
      "2430 placed blocks drawn with less detail, as the model is too heavy to draw in full",
    );
  });
});

describe("status words", () => {
  it("progress of the first sync", () => {
    expect(syncText({ done: 120, total: 4000 })).toBe("Syncing 120 of 4000");
    expect(syncText(null)).toBeNull();
  });

  it("the connection, with what to do when it is not there, for each host", () => {
    expect(connectionText("rhino", { connected: false, document: null, app: null })).toBe(
      "Not connected. Run HaiConnect in Rhino.",
    );
    expect(connectionText("blender", { connected: false, document: null, app: null })).toMatch(
      /HAI add-on in Blender/,
    );
    expect(connectionText("rhino", { connected: true, document: "tower.3dm", app: rhino })).toBe(
      "Rhino 8.36.0, tower.3dm",
    );
    expect(connectionText("rhino", { connected: true, document: null, app: rhino })).toMatch(/unsaved/);
  });

  it("run unavailable: ready, or why not and how to fix it", () => {
    expect(runText("rhino", { state: "ready" })).toBe("The agent can run code in Rhino");
    expect(runText("rhino", { state: "unavailable", reason: "no engine" })).toMatch(
      /The agent cannot run code in Rhino: no engine\..*run HaiConnect again/,
    );
    expect(runText("rhino", null)).toBeNull();
  });
});

describe("hostChip", () => {
  it("is absent for a host that is not connected, or switched off", () => {
    expect(hostChip("rhino", state({}))).toBeNull();
    expect(hostChip("rhino", state({ connected: true, switchedOn: false }))).toBeNull();
  });

  it("shows the host connected, then the sync, then that it cannot run code", () => {
    expect(hostChip("rhino", state({ connected: true, run: { state: "ready" } }))).toEqual({
      text: "Rhino connected",
      tone: "on",
    });
    expect(hostChip("blender", state({ connected: true, sync: { done: 5, total: 50 } }))).toEqual({
      text: "Syncing 5 of 50",
      tone: "busy",
    });
    expect(hostChip("rhino", state({ connected: true, run: { state: "unavailable", reason: "x" } }))).toEqual(
      {
        text: "Rhino: cannot run code",
        tone: "off",
      },
    );
  });
});
