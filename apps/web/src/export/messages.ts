import type { SceneDocument } from "@hai/protocol";
import type { MeshPart } from "@hai/scene";
import type { ExportResult } from "./build.ts";

/** Messages between the main thread and the export worker. */
export type ToExportWorker = {
  type: "build";
  doc: SceneDocument;
  /** The triangles of each imported model the scene uses, by asset id. */
  assets: Array<[string, MeshPart[]]>;
  /** Where the writer's WebAssembly file is served from (this app's own origin). */
  wasmBase: string;
};

export type FromExportWorker = { type: "done"; result: ExportResult } | { type: "failed"; message: string };
