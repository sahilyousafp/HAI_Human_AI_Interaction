import type { Element, SceneDocument, SceneOp, TaskScope } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { type Claim, ClaimTable } from "./claims.ts";

const column = (id: string, x: number, y = 0, tags?: Record<string, string>): Element => ({
  id,
  name: id,
  type: "column",
  properties: {},
  position: [x, y],
  section: [400, 400],
  height: 3000,
  ...(tags ? { tags } : {}),
});

const sceneOf = (elements: Element[]): SceneDocument => ({
  version: 1,
  units: "mm",
  up: "Z",
  name: "t",
  levels: [],
  elements: Object.fromEntries(elements.map((e) => [e.id, e])),
});

const update = (id: string): SceneOp => ({ op: "update", id, patch: { name: "x" } });
const create = (element: Element): SceneOp => ({ op: "create", element });

function table(...entries: Array<[string, string, TaskScope | null]>) {
  const claims = new ClaimTable();
  const granted = entries.map(([agent, title, scope]) =>
    claims.grant({ taskId: `${agent}-task`, agent, title, scope }),
  );
  return { claims, granted };
}

describe("ClaimTable overlap", () => {
  const doc = sceneOf([
    column("dome-1", 0, 0, { "hai.part": "dome" }),
    column("hall-1", 20_000, 0, { "hai.part": "hall" }),
  ]);
  const claims = new ClaimTable();

  it("a task with no scope overlaps everything", () => {
    expect(claims.overlap(null, { part: "dome" }, doc)).toBe(true);
    expect(claims.overlap({ part: "dome" }, null, doc)).toBe(true);
    expect(claims.overlap(null, null, doc)).toBe(true);
  });

  it("different parts, different ids and far regions do not overlap", () => {
    expect(claims.overlap({ part: "dome" }, { part: "hall" }, doc)).toBe(false);
    expect(claims.overlap({ ids: ["a"] }, { ids: ["b"] }, doc)).toBe(false);
    expect(
      claims.overlap(
        { region: { min: [0, 0], max: [5000, 5000] } },
        { region: { min: [10_000, 0], max: [15_000, 5000] } },
        doc,
      ),
    ).toBe(false);
  });

  it("the same part, a shared id and intersecting regions overlap", () => {
    expect(claims.overlap({ part: "dome" }, { part: "dome" }, doc)).toBe(true);
    expect(claims.overlap({ ids: ["a", "b"] }, { ids: ["b"] }, doc)).toBe(true);
    expect(
      claims.overlap(
        { region: { min: [0, 0], max: [5000, 5000] } },
        { region: { min: [4000, 4000], max: [9000, 9000] } },
        doc,
      ),
    ).toBe(true);
  });

  it("regions that only touch do not overlap", () => {
    expect(
      claims.overlap(
        { region: { min: [0, 0], max: [5000, 5000] } },
        { region: { min: [5000, 0], max: [9000, 5000] } },
        doc,
      ),
    ).toBe(false);
  });

  it("listed ids are resolved against the other scope's part and region", () => {
    expect(claims.overlap({ ids: ["dome-1"] }, { part: "dome" }, doc)).toBe(true);
    expect(claims.overlap({ ids: ["dome-1"] }, { part: "hall" }, doc)).toBe(false);
    expect(claims.overlap({ ids: ["dome-1"] }, { region: { min: [-500, -500], max: [500, 500] } }, doc)).toBe(
      true,
    );
    expect(claims.overlap({ ids: ["hall-1"] }, { region: { min: [-500, -500], max: [500, 500] } }, doc)).toBe(
      false,
    );
  });

  it("a part and a region overlap when an element of the part lies in the region", () => {
    expect(claims.overlap({ part: "dome" }, { region: { min: [-500, -500], max: [500, 500] } }, doc)).toBe(
      true,
    );
    expect(claims.overlap({ part: "hall" }, { region: { min: [-500, -500], max: [500, 500] } }, doc)).toBe(
      false,
    );
  });

  it("a region without z spans every height, one with z does not", () => {
    const high = {
      region: {
        min: [0, 0, 10_000] as [number, number, number],
        max: [5000, 5000, 12_000] as [number, number, number],
      },
    };
    const low = {
      region: {
        min: [0, 0, 0] as [number, number, number],
        max: [5000, 5000, 3000] as [number, number, number],
      },
    };
    expect(claims.overlap(high, low, doc)).toBe(false);
    expect(claims.overlap(high, { region: { min: [0, 0], max: [5000, 5000] } }, doc)).toBe(true);
  });
});

describe("ClaimTable membership and holders", () => {
  const doc = sceneOf([
    column("dome-1", 0, 0, { "hai.part": "dome" }),
    column("hall-1", 20_000, 0, { "hai.part": "hall" }),
    column("loose", 40_000),
  ]);

  it("a claim takes in its ids, its part's elements and elements in its region", () => {
    const { claims } = table(
      ["architect", "dome", { part: "dome" }],
      ["product", "hall", { ids: ["hall-1"] }],
      ["climate", "yard", { region: { min: [39_000, -1000], max: [41_000, 1000] } }],
    );
    expect(claims.holder(doc.elements["dome-1"] as Element, doc)?.agent).toBe("architect");
    expect(claims.holder(doc.elements["hall-1"] as Element, doc)?.agent).toBe("product");
    expect(claims.holder(doc.elements.loose as Element, doc)?.agent).toBe("climate");
    expect(
      claims.holder(doc.elements["dome-1"] as Element, doc, claims.forAgent("architect")),
    ).toBeUndefined();
  });

  it("an element that two claims could take in belongs to the one granted first", () => {
    const { claims } = table(
      ["architect", "west", { region: { min: [-1000, -1000], max: [500, 1000] } }],
      ["product", "east", { region: { min: [-500, -1000], max: [1000, 1000] } }],
    );
    expect(claims.holder(doc.elements["dome-1"] as Element, doc)?.agent).toBe("architect");
  });

  it("a claim with no scope holds everything", () => {
    const { claims } = table(["architect", "all", null]);
    expect(claims.holder(doc.elements.loose as Element, doc)?.agent).toBe("architect");
  });
});

describe("ClaimTable.check", () => {
  const doc = sceneOf([
    column("dome-1", 0, 0, { "hai.part": "dome" }),
    column("wall-h1", 20_000, 0, { "hai.part": "hall" }),
    column("free", 40_000),
  ]);
  const setup = () => {
    const { claims, granted } = table(
      ["architect", "dome", { part: "dome" }],
      ["product", "hall", { part: "hall" }],
    );
    return { claims, architect: granted[0] as Claim, product: granted[1] as Claim };
  };

  it("lets a task change what it claims", () => {
    const { claims, architect } = setup();
    expect(claims.check(architect, [update("dome-1")], doc)).toEqual({ ok: true });
  });

  it("refuses another agent's element and names the holder, the task and the scope", () => {
    const { claims, architect } = setup();
    const result = claims.check(architect, [update("wall-h1")], doc);
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining(`"wall-h1" is claimed by product's task "hall"`),
    });
    expect(result.ok ? "" : result.error).toContain("request_claim");
  });

  it("refuses an unclaimed element that is outside the claim", () => {
    const { claims, architect } = setup();
    const result = claims.check(architect, [update("free")], doc);
    expect(result.ok ? "" : result.error).toContain(`"free" is outside your claim (the part "dome")`);
  });

  it("refuses a create outside the region and names it", () => {
    const claims = new ClaimTable();
    const own = claims.grant({
      taskId: "a",
      agent: "architect",
      title: "dome",
      scope: { region: { min: [-1000, -1000], max: [1000, 1000] } },
    });
    expect(claims.check(own, [create(column("in", 0))], doc)).toEqual({ ok: true });
    const out = claims.check(own, [create(column("out", 9000))], doc);
    expect(out.ok ? "" : out.error).toContain("outside your claim (the region x -1000 to 1000");
  });

  it("refuses the whole batch when one element is outside, and counts the rest", () => {
    const { claims, architect } = setup();
    const result = claims.check(architect, [update("dome-1"), update("wall-h1"), update("free")], doc);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toContain("and 1 more");
  });

  it("lets an element be created and then changed in the same batch", () => {
    const claims = new ClaimTable();
    const own = claims.grant({ taskId: "a", agent: "architect", title: "t", scope: { ids: ["new-1"] } });
    expect(claims.check(own, [create(column("new-1", 0)), update("new-1")], sceneOf([]))).toEqual({
      ok: true,
    });
  });

  it("a task with no scope may change anything nobody else holds", () => {
    const claims = new ClaimTable();
    const own = claims.grant({ taskId: "a", agent: "architect", title: "all", scope: null });
    expect(claims.check(own, [update("free"), update("wall-h1")], doc)).toEqual({ ok: true });
  });

  it("leaves a missing element to the scene to report", () => {
    const { claims, architect } = setup();
    expect(claims.check(architect, [update("nope")], doc)).toEqual({ ok: true });
  });
});

describe("ClaimTable user changes", () => {
  it("tells the owning task once, and only for elements in its claim", () => {
    const doc = sceneOf([column("hall-1", 0, 0, { "hai.part": "hall" }), column("free", 9000)]);
    const claims = new ClaimTable();
    claims.grant({ taskId: "p", agent: "product", title: "hall", scope: { part: "hall" } });
    claims.noteUserChange(["hall-1", "free"], doc, doc);
    expect([...claims.takeUserChanges("p", ["hall-1", "free"])]).toEqual(["hall-1"]);
    expect([...claims.takeUserChanges("p", ["hall-1"])]).toEqual([]);
  });

  it("forgets the notes when the claim is released", () => {
    const doc = sceneOf([column("hall-1", 0, 0, { "hai.part": "hall" })]);
    const claims = new ClaimTable();
    claims.grant({ taskId: "p", agent: "product", title: "hall", scope: { part: "hall" } });
    claims.noteUserChange(["hall-1"], doc, doc);
    claims.release("p");
    expect(claims.takeUserChanges("p", ["hall-1"]).size).toBe(0);
  });
});

describe("ClaimTable.withoutIds", () => {
  it("drops listed ids, keeps the rest, and says when nothing is left", () => {
    expect(ClaimTable.withoutIds({ ids: ["a", "b"], part: "p" }, ["a"])).toEqual({ ids: ["b"], part: "p" });
    expect(ClaimTable.withoutIds({ ids: ["a"], part: "p" }, ["a"])).toEqual({ part: "p" });
    expect(ClaimTable.withoutIds({ ids: ["a"] }, ["a"])).toBeUndefined();
  });
});

describe("ClaimTable speed", () => {
  it("checks 100 elements in a 5000-element model in under 5 ms at the 90th percentile", () => {
    const elements = Array.from({ length: 5000 }, (_, i) =>
      column(`c-${i}`, (i % 100) * 1000, Math.floor(i / 100) * 1000, { "hai.part": `part-${i % 3}` }),
    );
    const doc = sceneOf(elements);
    const { claims, granted } = table(
      ["a", "one", { part: "part-0" }],
      ["b", "two", { part: "part-1" }],
      ["c", "three", { region: { min: [0, 0], max: [20_000, 20_000] } }],
    );
    const own = granted[0] as Claim;
    const ops = elements
      .filter((_, i) => i % 3 === 0)
      .slice(0, 100)
      .map((e) => update(e.id));
    const times: number[] = [];
    for (let run = 0; run < 100; run++) {
      const start = performance.now();
      claims.check(own, ops, doc);
      times.push(performance.now() - start);
    }
    times.sort((x, y) => x - y);
    expect(times[89] as number).toBeLessThan(5);
  });
});

describe("ClaimTable output files", () => {
  const owner = (agent: string) => ({ taskId: `${agent}-task`, agent, title: `${agent} job` });

  it("a second task naming a reserved file is refused, naming the first", () => {
    const claims = new ClaimTable();
    expect(claims.reserve(owner("architect"), ["canopy.3dm"])).toEqual({ ok: true });
    const refused = claims.reserve(owner("product"), ["Canopy.3dm"]);
    expect(refused).toEqual({
      ok: false,
      error: expect.stringContaining(`reserved by architect's task "architect job"`),
    });
  });

  it("a refusal reserves nothing, and a task may reserve its own file again", () => {
    const claims = new ClaimTable();
    claims.reserve(owner("architect"), ["a.3dm"]);
    expect(claims.reserve(owner("product"), ["b.3dm", "a.3dm"]).ok).toBe(false);
    expect(claims.reserve(owner("climate"), ["b.3dm"]).ok).toBe(true);
    expect(claims.reserve(owner("architect"), ["a.3dm"]).ok).toBe(true);
  });

  it("the files are free again when the task's claim ends", () => {
    const claims = new ClaimTable();
    claims.grant({ ...owner("architect"), scope: null });
    claims.reserve(owner("architect"), ["a.3dm"]);
    claims.release("architect-task");
    expect(claims.reserve(owner("product"), ["a.3dm"]).ok).toBe(true);
  });
});
