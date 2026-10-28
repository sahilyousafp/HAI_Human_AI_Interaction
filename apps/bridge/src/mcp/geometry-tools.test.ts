import { Element, type SceneDocument, SceneOp } from "@hai/protocol";
import { decodeMeshAsset } from "@hai/scene";
import type { McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type { KernelOutcome, Recipe } from "../geometry/kernel.ts";
import { type GeometryToolDeps, registerGeometryTools } from "./geometry-tools.ts";

type Handler = (
  input: unknown,
  ctx: unknown,
) => Promise<{ content: Array<{ text?: string }>; isError?: boolean }>;

const doc = (elements: unknown[]): SceneDocument => ({
  version: 1,
  units: "mm",
  up: "Z",
  name: "test",
  levels: [{ id: "L1", name: "Level 1", elevation: 0 }],
  elements: Object.fromEntries(
    elements.map((e) => {
      const element = Element.parse({ properties: {}, ...(e as object) });
      return [element.id, element];
    }),
  ),
});

const column = {
  id: "post",
  name: "Post",
  type: "column",
  position: [0, 0],
  section: [200, 150],
  height: 2400,
};
const massing = (id: string, x: number) => ({
  id,
  name: id,
  type: "massing",
  origin: [x, 0, 0],
  size: [1000, 1000, 1000],
});
const rail = {
  id: "rail",
  name: "Rail",
  type: "line",
  points: [
    [0, 0, 0],
    [3000, 0, 0],
  ],
};
const section = (id: string, z: number) => ({
  id,
  name: id,
  type: "line",
  closed: true,
  points: [
    [0, 0, z],
    [1000, 0, z],
    [1000, 1000, z],
    [0, 1000, z],
  ],
});

const TETRAHEDRON = {
  positions: [0, 0, 0, 1000, 0, 0, 0, 1000, 0, 0, 0, 1000],
  indices: [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3],
};

/** The tools registered against a fake server, with what the kernel was asked and what the scene was told. */
function harness(scene: SceneDocument, answer: KernelOutcome | ((recipe: Recipe) => KernelOutcome)) {
  const tools = new Map<string, { inputSchema: z.ZodType; handler: Handler }>();
  const register = ((name: string, config: { inputSchema: z.ZodType }, handler: Handler) => {
    tools.set(name, { inputSchema: config.inputSchema, handler });
  }) as unknown as McpServer["registerTool"];
  const recipes: Recipe[] = [];
  const stored = new Map<string, Uint8Array>();
  const removed: string[] = [];
  const applied: SceneOp[][] = [];
  let applyFails: string | null = null;
  const deps: GeometryToolDeps = {
    doc: () => scene,
    apply: (ops) => {
      if (applyFails) return { ok: false, error: applyFails };
      for (const op of ops) SceneOp.parse(op);
      applied.push(ops);
      return { ok: true };
    },
    geometry: {
      kernel: {
        run: async (recipe) => {
          recipes.push(recipe);
          return typeof answer === "function" ? answer(recipe) : answer;
        },
      },
      storeAsset: async (id, bytes) => {
        stored.set(id, bytes);
        return { ok: true };
      },
      removeAsset: (id) => removed.push(id),
    },
  };
  registerGeometryTools(register, deps, { agent: "architect" });
  return {
    recipes,
    stored,
    removed,
    applied,
    failApplyWith: (message: string) => {
      applyFails = message;
    },
    call: async (name: string, input: unknown) => {
      const tool = tools.get(name);
      if (!tool) throw new Error(`no tool ${name}`);
      const result = await tool.handler(tool.inputSchema.parse(input), {
        mcpReq: { signal: new AbortController().signal },
      });
      const body = result.content[0]?.text ?? "";
      return { failed: result.isError === true, body, json: () => JSON.parse(body) };
    },
  };
}

const mesh = (): KernelOutcome => ({
  ok: true,
  answer: { ok: true, parts: [TETRAHEDRON], volume: 1.5, valid: true },
});

describe("geometry_array_along_curve", () => {
  it("makes a copy of the element at each place along a line element, in one change", async () => {
    const h = harness(doc([column, rail]), mesh());
    const result = await h.call("geometry_array_along_curve", {
      element: "post",
      rail: "rail",
      spacing: 1000,
    });
    expect(result.failed).toBe(false);
    expect(result.json().created).toHaveLength(4);
    expect(h.applied).toHaveLength(1);
    const positions = h.applied[0]?.map((op) =>
      op.op === "create" && op.element.type === "column" ? op.element.position : null,
    );
    expect(positions).toEqual([
      [0, 0],
      [1000, 0],
      [2000, 0],
      [3000, 0],
    ]);
    expect(h.recipes).toHaveLength(0);
  });

  it("tapers a width set in millimetres, from 15 cm every 30 cm", async () => {
    const h = harness(doc([massing("fin", 0), rail]), mesh());
    await h.call("geometry_array_along_curve", {
      element: "fin",
      rail: "rail",
      spacing: 300,
      width: { from: 150, to: 50 },
    });
    const sizes = h.applied[0]?.map((op) =>
      op.op === "create" && op.element.type === "massing" ? op.element.size[1] : null,
    );
    expect(sizes).toHaveLength(11);
    expect(sizes?.[0]).toBeCloseTo(150);
    expect(sizes?.at(-1)).toBeCloseTo(50);
  });

  it("takes the points of a sketch as the rail", async () => {
    const h = harness(doc([column]), mesh());
    const result = await h.call("geometry_array_along_curve", {
      element: "post",
      rail: {
        points: [
          [0, 0, 0],
          [0, 2000, 0],
        ],
      },
      count: 3,
    });
    expect(result.json().created).toHaveLength(3);
  });

  it("does not carry the system's tags to the copies", async () => {
    const tagged = { ...column, tags: { "hai.owner": "architect", note: "keep" } };
    const h = harness(doc([tagged, rail]), mesh());
    await h.call("geometry_array_along_curve", { element: "post", rail: "rail", count: 2 });
    const first = h.applied[0]?.[0];
    expect(first?.op === "create" ? first.element.tags : null).toEqual({ note: "keep" });
  });

  it.each([
    [{ element: "nobody", rail: "rail", count: 2 }, 'No element "nobody"'],
    [{ element: "post", rail: "post", count: 2 }, "not a line"],
    [{ element: "post", rail: "rail" }, "either spacing or count"],
    [{ element: "post", rail: "rail", spacing: 1 }, "at most 500"],
  ])("changes nothing for %j", async (input, why) => {
    const h = harness(doc([column, rail]), mesh());
    const result = await h.call("geometry_array_along_curve", input);
    expect(result.failed).toBe(true);
    expect(result.body).toContain(why);
    expect(h.applied).toHaveLength(0);
  });
});

describe("geometry_loft", () => {
  it("sends the sections to the kernel and brings the mesh in as one imported model", async () => {
    const h = harness(doc([section("a", 0), section("b", 1000)]), mesh());
    const result = await h.call("geometry_loft", { sections: ["a", "b"], ruled: true });
    expect(result.failed).toBe(false);
    expect(h.recipes[0]).toMatchObject({ recipe: "loft", ruled: true });
    expect((h.recipes[0] as { sections: unknown[] }).sections).toHaveLength(2);
    expect(h.applied).toHaveLength(1);
    const created = h.applied[0]?.[0];
    if (created?.op !== "create" || created.element.type !== "imported") throw new Error("not imported");
    expect(created.element.bounds).toEqual({ min: [0, 0, 0], max: [1000, 1000, 1000] });
    const bytes = h.stored.get(created.element.asset);
    expect(bytes).toBeDefined();
    const decoded = decodeMeshAsset(bytes as Uint8Array);
    expect(decoded.ok && decoded.parts[0]?.indices.length).toBe(12);
    expect(result.json()).toMatchObject({ valid: true, volumeMm3: 1.5, triangles: 4 });
  });

  it("keeps the section lines unless asked to delete them, then deletes them in the same change", async () => {
    const lines = [section("a", 0), section("b", 1000)];
    const keep = harness(doc(lines), mesh());
    await keep.call("geometry_loft", { sections: ["a", "b"] });
    expect(keep.applied[0]).toHaveLength(1);

    const drop = harness(doc(lines), mesh());
    const result = await drop.call("geometry_loft", { sections: ["a", "b"], deleteInputs: true });
    expect(drop.applied[0]?.map((op) => op.op)).toEqual(["create", "delete", "delete"]);
    expect(result.json().deleted).toEqual(["a", "b"]);
  });

  it("changes nothing, and keeps no mesh, when the scene refuses the change", async () => {
    const h = harness(doc([section("a", 0), section("b", 1000)]), mesh());
    h.failApplyWith("claimed by another agent");
    const result = await h.call("geometry_loft", { sections: ["a", "b"] });
    expect(result.failed).toBe(true);
    expect(result.body).toContain("claimed by another agent");
    expect(h.removed).toEqual([...h.stored.keys()]);
  });

  it("names a section that is not a line without calling the kernel", async () => {
    const h = harness(doc([section("a", 0), massing("m", 0)]), mesh());
    const result = await h.call("geometry_loft", { sections: ["a", "m"] });
    expect(result.failed).toBe(true);
    expect(result.body).toContain('"m" is a massing, not a line');
    expect(h.recipes).toHaveLength(0);
  });

  it("passes the kernel's own complaint on, and changes nothing", async () => {
    const h = harness(doc([section("a", 0), section("b", 1000)]), {
      ok: false,
      error: "Draw them in order.",
    });
    const result = await h.call("geometry_loft", { sections: ["a", "b"] });
    expect(result.failed).toBe(true);
    expect(result.body).toContain("Draw them in order.");
    expect(h.applied).toHaveLength(0);
    expect(h.stored.size).toBe(0);
  });
});

describe("geometry_sweep", () => {
  it("sweeps a profile along a rail", async () => {
    const h = harness(doc([section("profile", 0), rail]), mesh());
    await h.call("geometry_sweep", { profile: "profile", rail: "rail", smooth: true, name: "Beam" });
    expect(h.recipes[0]).toMatchObject({ recipe: "sweep", smooth: true });
    const created = h.applied[0]?.[0];
    expect(created?.op === "create" ? created.element.name : null).toBe("Beam");
  });
});

describe("geometry_boolean", () => {
  const solids = [massing("a", 0), massing("b", 500)];

  it("takes massings as extrusions of their footprints and deletes them by default", async () => {
    const h = harness(doc(solids), mesh());
    const result = await h.call("geometry_boolean", { operation: "union", a: ["a"], b: ["b"] });
    expect(h.recipes[0]).toMatchObject({
      recipe: "boolean",
      op: "union",
      a: [{ z0: 0, z1: 1000 }],
      b: [{ z0: 0, z1: 1000 }],
    });
    expect(h.applied[0]?.map((op) => op.op)).toEqual(["create", "delete", "delete"]);
    expect(result.json().deleted).toEqual(["a", "b"]);
    const created = h.applied[0]?.[0];
    expect(created?.op === "create" ? created.element.name : null).toBe("Union");
  });

  it("keeps the solids when told to", async () => {
    const h = harness(doc(solids), mesh());
    await h.call("geometry_boolean", { operation: "difference", a: ["a"], b: ["b"], deleteInputs: false });
    expect(h.applied[0]).toHaveLength(1);
  });

  it("refuses a mesh or a line, saying so", async () => {
    const h = harness(doc([massing("a", 0), rail]), mesh());
    const result = await h.call("geometry_boolean", { operation: "union", a: ["a"], b: ["rail"] });
    expect(result.failed).toBe(true);
    expect(result.body).toContain("a line, not a solid");
    expect(h.recipes).toHaveLength(0);
  });
});

describe("geometry_offset", () => {
  it("makes the offset curves as line elements on the same level", async () => {
    const closed = { ...section("plan", 0), level: "L1" };
    const h = harness(doc([closed]), {
      ok: true,
      answer: {
        ok: true,
        curves: [
          {
            points: [
              [-100, -100, 0],
              [1100, -100, 0],
              [1100, 1100, 0],
              [-100, 1100, 0],
            ],
            closed: true,
          },
        ],
      },
    });
    const result = await h.call("geometry_offset", { curve: "plan", distance: 100, corners: "round" });
    expect(h.recipes[0]).toMatchObject({ recipe: "offset", distance: 100, corners: "round" });
    const created = h.applied[0]?.[0];
    expect(created?.op === "create" && created.element.type === "line" && created.element.level).toBe("L1");
    expect(result.json().created).toHaveLength(1);
    expect(h.stored.size).toBe(0);
  });

  it("refuses a distance of zero", async () => {
    const h = harness(doc([section("plan", 0)]), mesh());
    await expect(h.call("geometry_offset", { curve: "plan", distance: 0 })).rejects.toThrow();
  });
});
