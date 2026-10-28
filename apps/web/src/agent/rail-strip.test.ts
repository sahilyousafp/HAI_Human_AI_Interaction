import { STRIP_PRESETS, type StripLayout } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { planStrip, type StripFacts } from "./rail-strip.ts";

const preset = (name: keyof typeof STRIP_PRESETS): StripLayout => ({
  preset: name,
  items: [...STRIP_PRESETS[name]],
});
const idle: StripFacts = { waiting: 0, lastLine: null, teamSize: 3, teamActive: 0 };
const kinds = (layout: StripLayout, facts: StripFacts, room = 600) =>
  planStrip(layout, facts, room).parts.map((p) => p.kind);

describe("planStrip", () => {
  it("Quiet: the state, the name, what waits, and the microphone at the foot", () => {
    expect(kinds(preset("quiet"), idle)).toEqual(["state", "name", "mic"]);
    expect(kinds(preset("quiet"), { ...idle, waiting: 2 })).toEqual(["state", "name", "waiting", "mic"]);
  });

  it("Needs you first: bare when nothing waits, the alert when something does", () => {
    expect(planStrip(preset("needs-you"), idle, 600)).toEqual({
      parts: [{ kind: "state", compact: false }, { kind: "mic" }],
      alert: false,
    });
    expect(planStrip(preset("needs-you"), { ...idle, waiting: 2 }, 600)).toEqual({
      parts: [{ kind: "waiting", loud: true }, { kind: "mic" }],
      alert: true,
    });
  });

  it("Team: the agents, then what waits", () => {
    expect(planStrip(preset("team"), { ...idle, waiting: 1 }, 600).parts).toEqual([
      { kind: "team", compact: false },
      { kind: "waiting", loud: false },
      { kind: "mic" },
    ]);
  });

  it("an item with nothing to show is skipped, not drawn empty", () => {
    const custom: StripLayout = { preset: "custom", items: ["lastLine", "waiting", "state", "mic"] };
    expect(kinds(custom, idle)).toEqual(["state", "mic"]);
    expect(kinds(custom, { ...idle, lastLine: "The slab is placed." })).toEqual(["lastLine", "state", "mic"]);
  });

  it("with little room the lower items drop first, and the microphone stays", () => {
    const all: StripLayout = { preset: "custom", items: ["state", "name", "lastLine", "mic"] };
    expect(kinds(all, { ...idle, lastLine: "x" }, 140)).toEqual(["state", "mic"]);
    // 140 - 52 for the microphone = 88: the state's full size (92 + 12) does not fit, its dot does.
    expect(planStrip(all, { ...idle, lastLine: "x" }, 140).parts[0]).toEqual({
      kind: "state",
      compact: true,
    });
    // The first item that does not fit ends the list, so a smaller one below it is not drawn in its place.
    expect(kinds(all, { ...idle, lastLine: "x" }, 52 + 104 + 20)).toEqual(["state", "mic"]);
  });

  it("the team shrinks to the agents that are active before it is dropped", () => {
    const facts: StripFacts = { waiting: 0, lastLine: null, teamSize: 6, teamActive: 2 };
    const layout: StripLayout = { preset: "custom", items: ["team", "mic"] };
    expect(planStrip(layout, facts, 52 + 40 * 6 + 10).parts[0]).toEqual({ kind: "team", compact: false });
    expect(planStrip(layout, facts, 52 + 40 * 2 + 20).parts[0]).toEqual({ kind: "team", compact: true });
    expect(kinds(layout, facts, 60)).toEqual(["mic"]);
  });

  it("an empty list shows nothing but the chevron", () => {
    expect(planStrip({ preset: "custom", items: [] }, idle, 600)).toEqual({ parts: [], alert: false });
  });

  it("a loud count that does not fit is a small one", () => {
    expect(planStrip(preset("needs-you"), { ...idle, waiting: 3 }, 100).parts[0]).toEqual({
      kind: "waiting",
      loud: false,
    });
  });
});
