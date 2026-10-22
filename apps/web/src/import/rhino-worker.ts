/// <reference lib="webworker" />
import type { RhinoModule } from "rhino3dm";
// The browser build: it reaches for Node only when it is running in Node.
import rhino3dm from "rhino3dm/rhino3dm.module.js";
import { convert3dm } from "./convert.ts";
import type { FromImportWorker, ToImportWorker } from "./messages.ts";

/**
 * Reads a `.3dm` file off the main thread, so a big model never freezes the hands or the view. The WebAssembly
 * reader is loaded from this app's own origin on the first file, and the converted geometry goes back as transferred
 * buffers.
 */
const post = (message: FromImportWorker, transfer: Transferable[] = []) =>
  self.postMessage(message, transfer);

let reader: Promise<RhinoModule> | null = null;

self.onmessage = async (event: MessageEvent<ToImportWorker>) => {
  const { bytes, wasmBase } = event.data;
  try {
    post({ type: "stage", stage: "loading" });
    reader ??= rhino3dm({ locateFile: (file) => `${wasmBase}/${file}` });
    const rhino = await reader;
    post({ type: "stage", stage: "reading" });
    const result = convert3dm(rhino, new Uint8Array(bytes));
    const buffers = result.ok
      ? result.parts.flatMap((part) => [part.positions.buffer, part.indices.buffer] as ArrayBuffer[])
      : [];
    post({ type: "done", result }, buffers);
  } catch (error) {
    post({ type: "failed", message: (error as Error).message });
  }
};
