import type { SceneOp } from "@hai/protocol";
import { decodeMeshAsset } from "@hai/scene";
import { describe, expect, it, vi } from "vitest";
import type { ConvertResult } from "./convert.ts";
import { type ImporterDeps, type ImportFile, ModelImporter, summarise } from "./importer.ts";

const part = (name: string, dx: number, extra: object = {}) => ({
  name,
  positions: new Float32Array([dx, 0, 0, dx + 1000, 0, 0, dx, 2000, 3000]),
  indices: new Uint32Array([0, 1, 2]),
  ...extra,
});

const report = (imported: number, skipped: Partial<Record<string, number>> = {}) => ({
  imported,
  objects: imported,
  grouped: false,
  triangles: imported,
  units: { name: "millimeters", mm: 1, assumed: false },
  skipped: { curves: 0, points: 0, annotations: 0, blocks: 0, noMesh: 0, unsupported: 0, ...skipped },
});

const file = (name = "model.3dm"): ImportFile => ({ name, arrayBuffer: async () => new ArrayBuffer(8) });

function setup(result: ConvertResult, over: Partial<ImporterDeps> = {}) {
  const applied: Array<{ label: string; ops: SceneOp[] }> = [];
  const uploads: Array<{ id: string; bytes: Uint8Array }> = [];
  const deps: ImporterDeps = {
    convert: async () => result,
    upload: async (id, bytes) => void uploads.push({ id, bytes }),
    apply: (label, ops) => {
      applied.push({ label, ops });
      return true;
    },
    ...over,
  };
  const importer = new ModelImporter(deps);
  const framed: string[][] = [];
  importer.onImported((ids) => framed.push(ids));
  return { importer, applied, uploads, framed };
}

describe("ModelImporter", () => {
  it("stores one asset, then creates every object in one transaction, and frames the model", async () => {
    const parts = [part("Panel", 0, { layer: "Facade", color: "#ff0000" }), part("Slab", 5000)];
    const { importer, applied, uploads, framed } = setup({ ok: true, parts, report: report(2) });
    await importer.importFile(file("tower.3dm"));

    expect(uploads).toHaveLength(1);
    const stored = decodeMeshAsset(uploads[0]?.bytes as Uint8Array);
    expect(stored.ok && stored.parts).toHaveLength(2);
    expect(applied).toHaveLength(1);
    expect(applied[0]?.label).toBe("Import tower.3dm");
    const [first, second] = (applied[0]?.ops ?? []).map((op) => (op.op === "create" ? op.element : null));
    expect(first).toMatchObject({
      type: "imported",
      name: "Panel",
      asset: uploads[0]?.id,
      part: 0,
      layer: "Facade",
      color: "#ff0000",
      bounds: { min: [0, 0, 0], max: [1000, 2000, 3000] },
      translation: [0, 0, 0],
    });
    expect(second).toMatchObject({ part: 1, bounds: { min: [5000, 0, 0] } });
    expect(first?.id).not.toBe(second?.id);
    expect(framed).toEqual([[first?.id, second?.id]]);
    expect(importer.getSnapshot()).toMatchObject({ phase: "done", file: "tower.3dm" });
  });

  it("the report says what was imported and what was skipped", async () => {
    const { importer } = setup({
      ok: true,
      parts: [part("A", 0), part("B", 3000)],
      report: report(2, { curves: 4, annotations: 1 }),
    });
    await importer.importFile(file());
    const state = importer.getSnapshot();
    expect(state.phase === "done" && state.summary).toBe(
      "Imported 2 objects, read as millimeters. Skipped 5: 4 curves, 1 annotation.",
    );
  });

  it("only .3dm files are imported", async () => {
    const { importer, applied } = setup({ ok: true, parts: [], report: report(0) });
    await importer.importFile(file("photo.png"));
    expect(importer.getSnapshot()).toMatchObject({
      phase: "failed",
      message: "Only .3dm files can be imported.",
    });
    expect(applied).toHaveLength(0);
  });

  it("a file over the size limit is refused without being read", async () => {
    const read = vi.fn(async () => new ArrayBuffer(8));
    const { importer, applied } = setup({ ok: true, parts: [part("A", 0)], report: report(1) });
    await importer.importFile({ name: "huge.3dm", size: 600_000_000, arrayBuffer: read });
    expect(importer.getSnapshot()).toMatchObject({
      phase: "failed",
      message: expect.stringContaining("500 MB"),
    });
    expect(read).not.toHaveBeenCalled();
    expect(applied).toHaveLength(0);
  });

  it("a file that cannot be read changes nothing and says why", async () => {
    const { importer, applied, uploads } = setup({
      ok: false,
      error: "The file could not be read as a Rhino file.",
    });
    await importer.importFile(file());
    expect(importer.getSnapshot()).toMatchObject({
      phase: "failed",
      message: expect.stringContaining("Rhino file"),
    });
    expect(applied).toHaveLength(0);
    expect(uploads).toHaveLength(0);
  });

  it("a file with nothing importable changes nothing and lists what was skipped", async () => {
    const { importer, applied, uploads } = setup({ ok: true, parts: [], report: report(0, { curves: 3 }) });
    await importer.importFile(file());
    expect(importer.getSnapshot()).toMatchObject({
      phase: "failed",
      message: expect.stringContaining("3 curves"),
      report: { imported: 0 },
    });
    expect(applied).toHaveLength(0);
    expect(uploads).toHaveLength(0);
  });

  it("a failed upload changes nothing in the scene", async () => {
    const { importer, applied } = setup(
      { ok: true, parts: [part("A", 0)], report: report(1) },
      {
        upload: async () => {
          throw new Error("No project folder is open to keep the model in.");
        },
      },
    );
    await importer.importFile(file());
    expect(importer.getSnapshot()).toMatchObject({
      phase: "failed",
      message: expect.stringContaining("No project folder"),
    });
    expect(applied).toHaveLength(0);
  });

  it("an offline bridge is reported, not hidden", async () => {
    const { importer, framed } = setup(
      { ok: true, parts: [part("A", 0)], report: report(1) },
      { apply: () => false },
    );
    await importer.importFile(file());
    expect(importer.getSnapshot()).toMatchObject({
      phase: "failed",
      message: expect.stringContaining("offline"),
    });
    expect(framed).toEqual([]);
  });

  it("ignores a second file while one is being imported, and the report can be closed", async () => {
    let finish: (r: ConvertResult) => void = () => {};
    const slow = new Promise<ConvertResult>((resolve) => {
      finish = resolve;
    });
    const { importer, applied } = setup({ ok: false, error: "unused" }, { convert: () => slow });
    const first = importer.importFile(file("a.3dm"));
    await importer.importFile(file("b.3dm"));
    expect(importer.getSnapshot()).toMatchObject({ phase: "working", file: "a.3dm" });
    finish({ ok: true, parts: [part("A", 0)], report: report(1) });
    await first;
    expect(applied).toHaveLength(1);
    importer.dismiss();
    expect(importer.getSnapshot()).toEqual({ phase: "idle" });
  });

  it("a grouped model says so", () => {
    const text = summarise({ ...report(3), objects: 1200, grouped: true });
    expect(text).toBe(
      "Imported 1,200 objects as 3 elements, one per layer and colour, read as millimeters.".replace(
        "1,200",
        "1200",
      ),
    );
  });

  it("summarise says when the units were assumed", () => {
    const text = summarise({ ...report(1), units: { name: "millimetres", mm: 1, assumed: true } });
    expect(text).toMatch(/millimetres are assumed/);
  });
});

describe("hai.source", () => {
  it("each element made from a file's object records the file and the object's id; merged ones record none", async () => {
    const { importer, applied } = setup({
      ok: true,
      parts: [
        part("Panel", 0, { objectId: "11111111-2222-3333-4444-555555555555" }),
        part("Layer (40 objects)", 5000),
      ],
      report: report(2),
    });
    await importer.importFile(file("tower.3dm"));
    const [first, second] = (applied[0]?.ops ?? []).map((op) => (op.op === "create" ? op.element : null));
    expect(first?.tags).toEqual({ "hai.source": "tower.3dm#11111111-2222-3333-4444-555555555555" });
    expect(second?.tags).toBeUndefined();
  });

  it("a long file name is cut so the tag stays within 200 characters", async () => {
    const id = "11111111-2222-3333-4444-555555555555";
    const { importer, applied } = setup({
      ok: true,
      parts: [part("Panel", 0, { objectId: id })],
      report: report(1),
    });
    await importer.importFile(file(`${"long".repeat(100)}.3dm`));
    const element = applied[0]?.ops[0];
    const tag = element?.op === "create" ? element.element.tags?.["hai.source"] : undefined;
    expect(tag?.length).toBeLessThanOrEqual(200);
    expect(tag?.endsWith(`#${id}`)).toBe(true);
  });
});
