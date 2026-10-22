import type { Element, SceneOp } from "@hai/protocol";
import { encodeMeshAsset, partBounds } from "@hai/scene";
import {
  type ConvertResult,
  describeSkips,
  IMPORT_LIMITS,
  type ImportReport,
  totalSkipped,
} from "./convert.ts";

/** What the import is doing, or did last. */
export type ImportState =
  | { phase: "idle" }
  | { phase: "working"; file: string; stage: "reading" | "loading" | "converting" | "saving" }
  /** Something was imported. */
  | { phase: "done"; file: string; report: ImportReport; summary: string }
  /** Nothing was imported and the scene is unchanged; `report` is there when the file was read. */
  | { phase: "failed"; file: string; message: string; report?: ImportReport };

/** What the importer needs from the app; the real ones are the worker, the bridge and the scene client. */
export interface ImporterDeps {
  convert(bytes: ArrayBuffer, onStage: (stage: "loading" | "reading") => void): Promise<ConvertResult>;
  /** Stores the converted geometry with the bridge; rejects with a reason when it cannot. */
  upload(assetId: string, bytes: Uint8Array): Promise<void>;
  /** One scene transaction (one undo step); false when the bridge is offline. */
  apply(label: string, ops: SceneOp[]): boolean;
}

/** A file as the importer needs it: a browser `File` fits. */
export interface ImportFile {
  name: string;
  /** Bytes, when known: a file over the limit is refused without being read. */
  size?: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

const newAssetId = (): string => crypto.randomUUID();

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What the report says in a sentence: "Imported 5 objects, read as millimetres. Skipped 5: 4 curves, 1 annotation." */
export function summarise(report: ImportReport): string {
  const parts = [
    report.grouped
      ? `Imported ${plural(report.objects, "object")} as ${plural(report.imported, "element")}, one per layer and colour`
      : `Imported ${plural(report.imported, "object")}`,
  ];
  parts[0] += `, read as ${report.units.name}`;
  const skipped = totalSkipped(report.skipped);
  if (report.units.assumed) parts[0] += " (the file does not say, so millimetres are assumed)";
  const text = `${parts[0]}.`;
  return skipped > 0 ? `${text} Skipped ${skipped}: ${describeSkips(report.skipped)}.` : text;
}

/**
 * Brings a `.3dm` file into the project: read and converted in a worker, the geometry stored with the bridge as one
 * asset, then every object created in one scene transaction, so the whole import is one undo step. Any failure before
 * that last step leaves the scene as it was, and says why.
 */
export class ModelImporter {
  private state: ImportState = { phase: "idle" };
  private readonly listeners = new Set<() => void>();
  private readonly importedListeners = new Set<(ids: string[]) => void>();

  constructor(private readonly deps: ImporterDeps) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ImportState => this.state;

  /** Hears the ids of the elements an import created, once the scene transaction has been sent (to frame them). */
  onImported = (listener: (ids: string[]) => void): (() => void) => {
    this.importedListeners.add(listener);
    return () => this.importedListeners.delete(listener);
  };

  get busy(): boolean {
    return this.state.phase === "working";
  }

  /** Closes the report. */
  dismiss(): void {
    if (!this.busy) this.set({ phase: "idle" });
  }

  /** Tells the user a file cannot be imported without trying (a dropped picture, say). */
  reject(file: string, message: string): void {
    if (!this.busy) this.set({ phase: "failed", file, message });
  }

  async importFile(file: ImportFile): Promise<void> {
    if (this.busy) return;
    const name = file.name;
    if (!/\.3dm$/i.test(name)) {
      this.set({ phase: "failed", file: name, message: "Only .3dm files can be imported." });
      return;
    }
    if (file.size !== undefined && file.size > IMPORT_LIMITS.maxFileBytes) {
      this.set({
        phase: "failed",
        file: name,
        message: `The file is over the ${IMPORT_LIMITS.maxFileBytes / 1e6} MB limit for imports.`,
      });
      return;
    }
    try {
      this.set({ phase: "working", file: name, stage: "reading" });
      const bytes = await file.arrayBuffer();
      const result = await this.deps.convert(bytes, (stage) =>
        this.set({ phase: "working", file: name, stage }),
      );
      if (!result.ok) {
        this.set({ phase: "failed", file: name, message: result.error });
        return;
      }
      const { parts, report } = result;
      if (parts.length === 0) {
        const why = totalSkipped(report.skipped) > 0 ? ` Skipped: ${describeSkips(report.skipped)}.` : "";
        this.set({
          phase: "failed",
          file: name,
          message: `The file has nothing that can be imported.${why}`,
          report,
        });
        return;
      }
      this.set({ phase: "working", file: name, stage: "saving" });
      const asset = newAssetId();
      try {
        await this.deps.upload(asset, encodeMeshAsset(parts));
      } catch (error) {
        this.set({
          phase: "failed",
          file: name,
          message: `The model could not be saved with the project: ${(error as Error).message}`,
          report,
        });
        return;
      }
      const ops: SceneOp[] = parts.map((part, i) => {
        const bounds = partBounds(part);
        const element: Element = {
          id: `imp-${asset.slice(0, 8)}-${i}`,
          type: "imported",
          name: part.name,
          properties: {},
          asset,
          part: i,
          bounds,
          translation: [0, 0, 0],
          ...(part.layer ? { layer: part.layer } : {}),
          ...(part.color ? { color: part.color } : {}),
        };
        return { op: "create", element };
      });
      if (!this.deps.apply(`Import ${name}`, ops)) {
        this.set({
          phase: "failed",
          file: name,
          message: "The bridge is offline, so nothing was imported.",
          report,
        });
        return;
      }
      const ids = ops.flatMap((op) => (op.op === "create" ? [op.element.id] : []));
      for (const listener of this.importedListeners) listener(ids);
      this.set({ phase: "done", file: name, report, summary: summarise(report) });
    } catch (error) {
      this.set({ phase: "failed", file: name, message: `The import stopped: ${(error as Error).message}` });
    }
  }

  private set(state: ImportState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}
