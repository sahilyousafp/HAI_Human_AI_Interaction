/// <reference lib="webworker" />
import type { RhinoModule } from "rhino3dm";
// The browser build: it reaches for Node only when it is running in Node.
import rhino3dm from "rhino3dm/rhino3dm.module.js";
import { buildFile3dm } from "./build.ts";
import type { FromExportWorker, ToExportWorker } from "./messages.ts";

/**
 * Writes the project as a Rhino file off the main thread, so a big model never freezes the hands or the view. The
 * WebAssembly writer is the same one the import worker reads with, served from this app's own origin.
 */
const post = (message: FromExportWorker, transfer: Transferable[] = []) =>
  self.postMessage(message, transfer);

let writer: Promise<RhinoModule> | null = null;

self.onmessage = async (event: MessageEvent<ToExportWorker>) => {
  const { doc, assets, wasmBase } = event.data;
  try {
    writer ??= rhino3dm({ locateFile: (file) => `${wasmBase}/${file}` });
    const rhino = await writer;
    const result = buildFile3dm(rhino, { doc, assets: new Map(assets) });
    post({ type: "done", result }, result.ok ? [result.bytes.buffer as ArrayBuffer] : []);
  } catch (error) {
    post({ type: "failed", message: (error as Error).message });
  }
};
