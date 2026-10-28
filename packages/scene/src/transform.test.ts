import { type Element, Element as ElementSchema, type Level } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { elementBounds } from "./bounds.ts";
import { footprintOf, importedWorld } from "./placement.ts";
import { applySteps, type Transform, transformOp, transformPatch } from "./transform.ts";

const levels: Level[] = [{ id: "L1", name: "Level 1", elevation: 3000 }];
const common = { name: "x", properties: {} };

const massing = (extra: Record<string, unknown> = {}): Element =>
  ElementSchema.parse({
    ...common,
    id: "m",
    type: "massing",
    origin: [0, 0, 0],
    size: [4000, 2000, 3000],
    ...extra,
  });
const column = ElementSchema.parse({
  ...common,
  id: "c",
  type: "column",
  position: [1000, 1000],
  section: [400, 400],
  height: 3000,
});
const wall = ElementSchema.parse({
  ...common,
  id: "w",
  type: "wall",
  start: [0, 0],
  end: [4000, 0],
  height: 3000,
  thickness: 200,
});
const slab = ElementSchema.parse({
  ...common,
  id: "s",
  type: "slab",
  level: "L1",
  outline: [
    [0, 0],
    [4000, 0],
    [4000, 2000],
    [0, 2000],
  ],
  thickness: 200,
});
const line = ElementSchema.parse({
  ...common,
  id: "l",
  type: "line",
  points: [
    [0, 0, 0],
    [1000, 0, 500],
  ],
});
const imported = ElementSchema.parse({
  ...common,
  id: "i",
  type: "imported",
  asset: "00000000-0000-4000-8000-000000000000",
  part: 0,
  bounds: { min: [0, 0, 0], max: [2000, 1000, 500] },
});

const apply = (element: Element, patch: Record<string, unknown> | null): Element =>
  ElementSchema.parse({ ...element, ...patch });
const through = (element: Element, t: Transform): Element =>
  apply(element, transformPatch(element, t, levels));
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);
const closeAll = (actual: number[], expected: number[]) => {
  expect(actual).toHaveLength(expected.length);
  for (const [i, value] of expected.entries()) close(actual[i] as number, value);
};

describe("a rotated massing", () => {
  it("is bounded by the corners of its turned footprint", () => {
    const turned = massing({ rotationDeg: 90 });
    const { min, max } = elementBounds(turned, levels);
    // The 4000 x 2000 box turned a quarter about its centre (2000, 1000) is 2000 x 4000 about the same centre.
    closeAll([min[0], min[1], max[0], max[1]], [1000, -1000, 3000, 3000]);
    expect(footprintOf(turned)).toHaveLength(4);
  });

  it("turns about the point it is told to, and remembers the angle", () => {
    const out = through(massing(), { kind: "rotate", deg: 90, about: [0, 0] });
    if (out.type !== "massing") throw new Error("type");
    expect(out.rotationDeg).toBe(90);
    // The centre (2000, 1000) turned a quarter about the origin is (-1000, 2000).
    close(out.origin[0] + out.size[0] / 2, -1000);
    close(out.origin[1] + out.size[1] / 2, 2000);
  });

  it("two quarter turns are a half turn", () => {
    const t: Transform = { kind: "rotate", deg: 90, about: [2000, 1000] };
    const out = through(through(massing(), t), t);
    if (out.type !== "massing") throw new Error("type");
    expect(out.rotationDeg).toBe(180);
    expect(out.origin).toEqual([0, 0, 0].map((v, i) => (i < 2 ? expect.closeTo(v, 6) : v)));
  });

  it("scales about a point, its height included", () => {
    const out = through(massing(), { kind: "scale", factor: 2, about: [0, 0, 0] });
    if (out.type !== "massing") throw new Error("type");
    expect(out.size).toEqual([8000, 4000, 6000]);
    expect(out.origin).toEqual([0, 0, 0]);
  });

  it("a mirror reverses its turn", () => {
    const out = through(massing({ rotationDeg: 30 }), { kind: "mirror", axis: "x", at: 0 });
    if (out.type !== "massing") throw new Error("type");
    expect(out.rotationDeg).toBe(-30);
    close(out.origin[0] + out.size[0] / 2, -2000);
  });
});

describe("a column", () => {
  it("turns on its own spot and keeps its position when rotated about itself", () => {
    const out = through(column, { kind: "rotate", deg: 45, about: [1000, 1000] });
    if (out.type !== "column") throw new Error("type");
    expect(out.rotationDeg).toBe(45);
    expect(out.position).toEqual([expect.closeTo(1000, 6), expect.closeTo(1000, 6)]);
  });

  it("moves up by setting a base on its level", () => {
    const out = through(column, { kind: "translate", by: [0, 0, 500] });
    if (out.type !== "column") throw new Error("type");
    expect(out.base).toBe(500);
  });
});

describe("walls, slabs and lines", () => {
  it("move, turn and scale through their points", () => {
    const w = through(wall, { kind: "rotate", deg: 90, about: [0, 0] });
    if (w.type !== "wall") throw new Error("type");
    expect([w.end[0], w.end[1]]).toEqual([expect.closeTo(0, 6), expect.closeTo(4000, 6)]);
    const big = through(wall, { kind: "scale", factor: 0.5, about: [0, 0, 0] });
    if (big.type !== "wall") throw new Error("type");
    expect([big.end, big.height, big.thickness]).toEqual([[2000, 0], 1500, 100]);
    const l = through(line, { kind: "translate", by: [10, 20, 30] });
    if (l.type !== "line") throw new Error("type");
    expect(l.points[1]).toEqual([1010, 20, 530]);
  });

  it("a mirrored slab is still counter-clockwise", () => {
    const out = through(slab, { kind: "mirror", axis: "x", at: 0 });
    if (out.type !== "slab") throw new Error("type");
    const area2 = out.outline.reduce((sum, a, i) => {
      const b = out.outline[(i + 1) % out.outline.length] as [number, number];
      return sum + a[0] * b[1] - b[0] * a[1];
    }, 0);
    expect(area2).toBeGreaterThan(0);
  });
});

describe("an imported model", () => {
  it("keeps the foot of its box centre where a turn about that point leaves it", () => {
    const out = through(imported, { kind: "rotate", deg: 90, about: [1000, 500] });
    if (out.type !== "imported") throw new Error("type");
    expect(out.rotationDeg).toBe(90);
    const [x, y, z] = importedWorld(out, [1000, 500, 0]);
    closeAll([x, y, z], [1000, 500, 0]);
  });

  it("scales its box and lands its corners where the placement says", () => {
    const out = through(imported, { kind: "scale", factor: 2, about: [0, 0, 0] });
    if (out.type !== "imported") throw new Error("type");
    expect(out.scale).toBe(2);
    const { min, max } = elementBounds(out, levels);
    closeAll([...min, ...max], [0, 0, 0, 4000, 2000, 1000]);
  });

  it("is bounded by the turned box", () => {
    const out = through(imported, { kind: "rotate", deg: 90, about: [1000, 500] });
    const { min, max } = elementBounds(out, levels);
    // 2000 x 1000 turned a quarter about its centre (1000, 500) is 1000 x 2000 about it.
    closeAll([min[0], min[1], max[0], max[1]], [500, -500, 1500, 1500]);
  });

  it("cannot be mirrored", () => {
    expect(transformOp(imported, { kind: "mirror", axis: "x", at: 0 }, levels)).toBeNull();
  });
});

describe("steps in a chain", () => {
  it("each acts on what the one before left, about the group's centre", () => {
    // Move 6 m east, then turn a quarter about where the box now is: it stays 6 m east of where it began, centred.
    const result = applySteps(
      [massing()],
      [
        { kind: "translate", by: [6000, 0, 0] },
        { kind: "rotate", deg: 90 },
      ],
      levels,
    );
    if (!result.ok) throw new Error(result.error);
    const out = apply(massing(), result.patches.m ?? null);
    if (out.type !== "massing") throw new Error("type");
    expect(out.rotationDeg).toBe(90);
    closeAll([out.origin[0] + out.size[0] / 2, out.origin[1] + out.size[1] / 2], [8000, 1000]);
  });

  it("scales a group about its centre at its lowest height", () => {
    const result = applySteps([massing()], [{ kind: "scale", factor: 2 }], levels);
    if (!result.ok) throw new Error(result.error);
    const out = apply(massing(), result.patches.m ?? null);
    if (out.type !== "massing") throw new Error("type");
    expect(out.size).toEqual([8000, 4000, 6000]);
    closeAll([out.origin[0] + 4000, out.origin[1] + 2000, out.origin[2]], [2000, 1000, 0]);
  });

  it("changes nothing when one element cannot take a step", () => {
    const result = applySteps([massing(), imported], [{ kind: "mirror", axis: "x" }], levels);
    expect(result).toEqual({ ok: false, error: expect.stringContaining("cannot be mirrored") });
  });
});

describe("moveTo", () => {
  it("takes the group's plan centre and base to the point", () => {
    const done = applySteps([massing()], [{ kind: "moveTo", to: [10000, 5000, 500] }], levels);
    if (!done.ok) throw new Error(done.error);
    // 4000 x 2000 about its centre (2000, 1000), base 0: the centre lands on (10000, 5000) with its base at 500.
    expect(done.patches.m?.origin).toEqual([8000, 4000, 500]);
  });
});
