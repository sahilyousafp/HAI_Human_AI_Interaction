import type { SceneDocument, TeamClaim, TeamMemberInfo } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { agentColors, baseAgent, claimBoxes, scopeLabel } from "./owners.ts";

const member = (name: string, color: string): TeamMemberInfo => ({
  name,
  description: "",
  tools: [],
  aliases: [],
  color,
  writes: true,
  lead: false,
});
const members = [member("architect", "#d98fb6"), member("product", "#4aa3a2")];

const column = (id: string, x: number, tags?: Record<string, string>) =>
  ({
    id,
    name: id,
    type: "column",
    properties: {},
    position: [x, 0],
    section: [400, 400],
    height: 3000,
    ...(tags ? { tags } : {}),
  }) as SceneDocument["elements"][string];

const doc = (...elements: SceneDocument["elements"][string][]): SceneDocument => ({
  version: 1,
  units: "mm",
  up: "Z",
  name: "t",
  levels: [],
  elements: Object.fromEntries(elements.map((e) => [e.id, e])),
});

describe("agentColors", () => {
  it("looks an owner's colour up by its lower-case name", () => {
    const colors = agentColors(members);
    expect(colors.get("architect")).toBe("#d98fb6");
    expect(colors.get("product")).toBe("#4aa3a2");
    expect(colors.get("gone")).toBeUndefined();
  });
});

describe("claimBoxes", () => {
  const claim = (taskId: string, agent: string, scope: TeamClaim["scope"]): TeamClaim => ({
    taskId,
    agent,
    title: "t",
    scope,
    elements: 0,
  });

  it("draws a box for a region claim, in the agent's colour, and none for other scopes", () => {
    const boxes = claimBoxes(
      [
        claim("a", "architect", { region: { min: [0, 0, 0], max: [5000, 5000, 4000] } }),
        claim("b", "product", { part: "hall" }),
        claim("c", "product", null),
      ],
      members,
      doc(),
    );
    expect(boxes).toEqual([{ key: "a", color: "#d98fb6", min: [0, 0, 0], max: [5000, 5000, 4000] }]);
  });

  it("a worker's region is drawn in its specialist's colour", () => {
    const [box] = claimBoxes(
      [claim("w", "architect.2", { region: { min: [0, 0, 0], max: [1000, 1000, 1000] } })],
      members,
      doc(),
    );
    expect(box?.color).toBe("#d98fb6");
  });

  it("a region without a height spans the model's height", () => {
    const [box] = claimBoxes(
      [claim("a", "architect", { region: { min: [0, 0], max: [5000, 5000] } })],
      members,
      doc(column("tall", 0)),
    );
    expect(box).toMatchObject({ min: [0, 0, 0], max: [5000, 5000, 3000] });
  });
});

describe("scopeLabel", () => {
  it("says what a claim holds in a few words", () => {
    expect(scopeLabel(null)).toBe("the whole model");
    expect(scopeLabel({ part: "dome" })).toBe("part dome");
    expect(scopeLabel({ ids: ["a"] })).toBe("1 element");
    expect(scopeLabel({ ids: ["a", "b"], part: "dome", region: { min: [0, 0], max: [1, 1] } })).toBe(
      "part dome + 2 elements + region",
    );
  });
});

describe("workers", () => {
  it("a worker is named after its specialist with a number", () => {
    expect(baseAgent("architect.2")).toBe("architect");
    expect(baseAgent("architect.12")).toBe("architect");
    expect(baseAgent("architect")).toBe("architect");
    expect(baseAgent("architect.x")).toBe("architect.x");
  });
});
