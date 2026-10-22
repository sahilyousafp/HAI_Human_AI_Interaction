import type { Element, SceneDocument } from "@aex/protocol";
import type { MeshPart } from "@aex/scene";
import { describe, expect, it, vi } from "vitest";
import type { ExportResult } from "./build.ts";
import { type ExporterDeps, fileNameFor, ProjectExporter } from "./exporter.ts";

const ASSET = "0f8fad5b-d9cb-469f-a165-70867728950e";
const column: Element = {
  id: "c",
  type: "column",
  name: "C",
  properties: {},
  position: [0, 0],
  section: [400, 400],
  height: 3000,
};
const model: Element = {
  id: "i",
  type: "imported",
  name: "I",
  properties: {},
  asset: ASSET,
  part: 0,
  bounds: { min: [0, 0, 0], max: [1, 1, 1] },
  translation: [0, 0, 0],
};
const docOf = (...elements: Element[]): SceneDocument => ({
  version: 1,
  units: "mm",
  up: "Z",
  name: "Tower",
  levels: [{ id: "L0", name: "Ground", elevation: 0 }],
  elements: Object.fromEntries(elements.map((e) => [e.id, e])),
});
const parts: MeshPart[] = [{ positions: new Float32Array(9), indices: new Uint32Array([0, 1, 2]) }];
const ok: ExportResult = {
  ok: true,
  bytes: new Uint8Array([1, 2, 3]),
  report: { objects: 2, extrusions: 1, meshes: 1, skipped: [] },
};

function setup(doc: SceneDocument | null, over: Partial<ExporterDeps> = {}) {
  const downloads: Array<{ name: string; bytes: Uint8Array }> = [];
  const build = vi.fn(async () => ok);
  const deps: ExporterDeps = {
    doc: () => doc,
    projectName: () => "Tower",
    loadAsset: async () => parts,
    build,
    download: (name, bytes) => void downloads.push({ name, bytes }),
    ...over,
  };
  return { exporter: new ProjectExporter(deps), downloads, build };
}

describe("ProjectExporter", () => {
  it("fetches the models, writes the file, offers it for download and says what it saved", async () => {
    const { exporter, downloads, build } = setup(docOf(column, model));
    await exporter.save();
    expect(build).toHaveBeenCalledWith({ doc: expect.anything(), assets: [[ASSET, parts]] });
    expect(downloads).toEqual([{ name: "Tower.3dm", bytes: ok.bytes }]);
    const state = exporter.getSnapshot();
    expect(state).toMatchObject({ phase: "done", file: "Tower.3dm" });
    expect(state.phase === "done" && state.summary).toBe(
      "Saved 2 objects (1 extrusion, 1 mesh) to Tower.3dm.",
    );
  });

  it("an empty project says so, and no file is offered", async () => {
    const { exporter, downloads, build } = setup(docOf());
    await exporter.save();
    expect(exporter.getSnapshot()).toEqual({
      phase: "failed",
      message: "There is nothing to save: the project has no elements.",
    });
    expect(downloads).toHaveLength(0);
    expect(build).not.toHaveBeenCalled();
  });

  it("a writer error is shown and nothing is downloaded", async () => {
    const { exporter, downloads } = setup(docOf(column), {
      build: async () => ({ ok: false, error: "The file writer stopped." }),
    });
    await exporter.save();
    expect(exporter.getSnapshot()).toEqual({ phase: "failed", message: "The file writer stopped." });
    expect(downloads).toHaveLength(0);
  });

  it("what was left out is part of the summary", async () => {
    const { exporter } = setup(docOf(column, model), {
      build: async () => ({
        ok: true,
        bytes: new Uint8Array(),
        report: { objects: 1, extrusions: 1, meshes: 0, skipped: ["I: its model file is missing"] },
      }),
      loadAsset: async () => null,
    });
    await exporter.save();
    const state = exporter.getSnapshot();
    expect(state.phase === "done" && state.summary).toBe(
      "Saved 1 object (1 extrusion) to Tower.3dm. Left out: I: its model file is missing.",
    );
  });

  it("ignores a second save while one runs, and names the file safely", async () => {
    let release: (r: ExportResult) => void = () => {};
    const slow = new Promise<ExportResult>((resolve) => {
      release = resolve;
    });
    const { exporter, build } = setup(docOf(column), { build: () => slow });
    const first = exporter.save();
    await exporter.save();
    expect(exporter.busy).toBe(true);
    release(ok);
    await first;
    expect(build).not.toHaveBeenCalled(); // the slow stand-in was used, not the spy
    expect(fileNameFor('My: "tower" / v2')).toBe("My- -tower- - v2.3dm");
    expect(fileNameFor("   ")).toBe("project.3dm");
  });

  it("the scene is never touched", async () => {
    const doc = docOf(column, model);
    const before = JSON.stringify(doc);
    const { exporter } = setup(doc);
    await exporter.save();
    expect(JSON.stringify(doc)).toBe(before);
  });
});
