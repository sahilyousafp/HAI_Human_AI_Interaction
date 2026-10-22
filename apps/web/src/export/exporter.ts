import type { SceneDocument } from "@aex/protocol";
import type { MeshPart } from "@aex/scene";
import type { ExportReport, ExportResult } from "./build.ts";

/** What saving is doing, or did last. */
export type ExportState =
  | { phase: "idle" }
  | { phase: "working"; stage: "gathering" | "writing" }
  /** The file was built and offered as a download. */
  | { phase: "done"; file: string; report: ExportReport; summary: string }
  | { phase: "failed"; message: string };

/** What the exporter needs from the app; the real ones are the scene client, the asset cache and the worker. */
export interface ExporterDeps {
  doc(): SceneDocument | null;
  /** The open project's name, which names the file. */
  projectName(): string;
  /** The triangles of an imported model, or null when it cannot be had. */
  loadAsset(id: string): Promise<MeshPart[] | null>;
  build(input: { doc: SceneDocument; assets: Array<[string, MeshPart[]]> }): Promise<ExportResult>;
  /** Offers the bytes to the user as a download. */
  download(fileName: string, bytes: Uint8Array): void;
}

/** A file name from a project name: no path characters, with the extension. */
export function fileNameFor(projectName: string): string {
  const clean = projectName.replace(/[\\/:*?"<>|]+/g, "-").trim() || "project";
  return `${clean}.3dm`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What the report says in a sentence: "Saved 4 objects (3 extrusions, 1 mesh) to Tower.3dm." */
export function summarise(file: string, report: ExportReport): string {
  const parts = [plural(report.extrusions, "extrusion"), plural(report.meshes, "mesh", "meshes")].filter(
    (p) => !p.startsWith("0 "),
  );
  const text = `Saved ${plural(report.objects, "object")} (${parts.join(", ")}) to ${file}.`;
  return report.skipped.length > 0 ? `${text} Left out: ${report.skipped.join("; ")}.` : text;
}

/**
 * Saves the open project as a Rhino file: the imported models it uses are fetched, the file is written in a worker, and
 * the bytes are offered as a download. The scene is never changed, and an empty project says so instead of saving.
 */
export class ProjectExporter {
  private state: ExportState = { phase: "idle" };
  private readonly listeners = new Set<() => void>();

  constructor(private readonly deps: ExporterDeps) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ExportState => this.state;

  get busy(): boolean {
    return this.state.phase === "working";
  }

  dismiss(): void {
    if (!this.busy) this.set({ phase: "idle" });
  }

  async save(): Promise<void> {
    if (this.busy) return;
    const doc = this.deps.doc();
    if (!doc || Object.keys(doc.elements).length === 0) {
      this.set({ phase: "failed", message: "There is nothing to save: the project has no elements." });
      return;
    }
    try {
      this.set({ phase: "working", stage: "gathering" });
      const used = [
        ...new Set(Object.values(doc.elements).flatMap((e) => (e.type === "imported" ? [e.asset] : []))),
      ];
      const assets: Array<[string, MeshPart[]]> = [];
      for (const id of used) {
        const parts = await this.deps.loadAsset(id);
        if (parts) assets.push([id, parts]); // a missing one is reported by the writer, element by element
      }
      this.set({ phase: "working", stage: "writing" });
      const result = await this.deps.build({ doc, assets });
      if (!result.ok) {
        this.set({ phase: "failed", message: result.error });
        return;
      }
      const file = fileNameFor(this.deps.projectName());
      this.deps.download(file, result.bytes);
      this.set({ phase: "done", file, report: result.report, summary: summarise(file, result.report) });
    } catch (error) {
      this.set({ phase: "failed", message: `Saving stopped: ${(error as Error).message}` });
    }
  }

  private set(state: ExportState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}
