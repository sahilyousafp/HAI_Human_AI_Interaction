import type { RhinoChange, RhinoRunChanges } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { ClaimTable } from "./claims.ts";
import { findStrays, MAX_STRAYS, strayNote } from "./rhino-run-check.ts";

const change = (id: string, tags: Record<string, string> = {}, at = 0): RhinoChange => ({
  id,
  name: `Object ${id}`,
  tags,
  bounds: { min: [at, 0, 0], max: [at + 1000, 1000, 1000] },
});
const changes = (parts: Partial<RhinoRunChanges>): RhinoRunChanges => ({
  added: [],
  changed: [],
  deleted: [],
  truncated: false,
  ...parts,
});

function setup() {
  const claims = new ClaimTable();
  const architect = claims.grant({ taskId: "a", agent: "architect", title: "dome", scope: { part: "dome" } });
  claims.grant({ taskId: "p", agent: "product", title: "hall", scope: { part: "hall" } });
  return { claims, architect };
}

describe("findStrays", () => {
  it("objects added or changed in the claim's part are not strays", () => {
    const { claims, architect } = setup();
    const result = findStrays(
      changes({
        added: [change("n", { "hai.part": "dome" })],
        changed: [change("d", { "hai.part": "dome" })],
      }),
      architect,
      claims,
    );
    expect(result).toEqual({ strays: [], truncated: false });
  });

  it("a changed object of another task's part is a stray that names the holder", () => {
    const { claims, architect } = setup();
    const { strays } = findStrays(
      changes({ changed: [change("h", { "hai.part": "hall" })] }),
      architect,
      claims,
    );
    expect(strays).toEqual([
      {
        id: "h",
        name: "Object h",
        what: "changed",
        holder: expect.stringContaining(`product's task "hall"`),
      },
    ]);
  });

  it("an object nobody holds but outside the claim is a stray without a holder; deletes count too", () => {
    const { claims, architect } = setup();
    const { strays } = findStrays(
      changes({ changed: [change("x")], deleted: [change("y")] }),
      architect,
      claims,
    );
    expect(strays.map((s) => [s.what, s.id, s.holder])).toEqual([
      ["changed", "x", undefined],
      ["deleted", "y", undefined],
    ]);
  });

  it("a claim of listed ids cannot name new objects, so adding some is fine; changing others is not", () => {
    const claims = new ClaimTable();
    const own = claims.grant({ taskId: "a", agent: "architect", title: "walls", scope: { ids: ["w-1"] } });
    expect(findStrays(changes({ added: [change("new")] }), own, claims).strays).toEqual([]);
    expect(findStrays(changes({ changed: [change("w-1")] }), own, claims).strays).toEqual([]);
    expect(findStrays(changes({ changed: [change("w-2")] }), own, claims).strays).toHaveLength(1);
  });

  it("a region claim: an added object outside it strays, one inside does not", () => {
    const claims = new ClaimTable();
    const own = claims.grant({
      taskId: "a",
      agent: "architect",
      title: "yard",
      scope: { region: { min: [0, 0], max: [5000, 5000] } },
    });
    expect(findStrays(changes({ added: [change("in", {}, 1000)] }), own, claims).strays).toEqual([]);
    expect(findStrays(changes({ added: [change("out", {}, 20_000)] }), own, claims).strays).toHaveLength(1);
  });

  it("a task with no scope has the whole model: only another task's objects stray", () => {
    const claims = new ClaimTable();
    const own = claims.grant({ taskId: "a", agent: "architect", title: "all", scope: null });
    claims.grant({ taskId: "p", agent: "product", title: "hall", scope: { part: "hall" } });
    const { strays } = findStrays(
      changes({ changed: [change("free"), change("h", { "hai.part": "hall" })] }),
      own,
      claims,
    );
    expect(strays.map((s) => s.id)).toEqual(["h"]);
  });

  it("an agent with no running claim is not checked", () => {
    const { claims } = setup();
    expect(findStrays(changes({ changed: [change("x")] }), undefined, claims).strays).toEqual([]);
  });

  it("lists at most MAX_STRAYS and says there are more", () => {
    const { claims, architect } = setup();
    const many = Array.from({ length: MAX_STRAYS + 20 }, (_, i) => change(`o-${i}`));
    const result = findStrays(changes({ changed: many }), architect, claims);
    expect(result.strays).toHaveLength(MAX_STRAYS);
    expect(result.truncated).toBe(true);
  });
});

describe("strayNote", () => {
  it("says it was checked afterwards, what was touched, and that the run is one undo step", () => {
    const note = strayNote(
      [{ id: "h", name: "Hall wall", what: "changed", holder: `product's task "hall"` }],
      false,
    );
    expect(note).toContain("Checked after the run");
    expect(note).toContain('- changed "Hall wall" (h), in product\'s task "hall"');
    expect(note).toContain("one undo step in Rhino");
  });
});
