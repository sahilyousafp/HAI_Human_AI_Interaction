import type { ConvertResult } from "./convert.ts";

/** Messages between the main thread and the import worker. The file's bytes travel inward, geometry outward. */
export type ToImportWorker = {
  type: "convert";
  /** The `.3dm` file's bytes (transferred). */
  bytes: ArrayBuffer;
  /** Where the reader's WebAssembly file is served from (this app's own origin). */
  wasmBase: string;
};

export type FromImportWorker =
  | { type: "stage"; stage: "loading" | "reading" }
  | { type: "done"; result: ConvertResult }
  | { type: "failed"; message: string };
