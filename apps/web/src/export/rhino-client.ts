import type { ExportResult } from "./build.ts";
import type { FromExportWorker, ToExportWorker } from "./messages.ts";

/** Writes a Rhino file in a worker of its own, which is dropped afterwards so the writer's memory is returned. */
export function buildInWorker(input: Omit<ToExportWorker, "type" | "wasmBase">): Promise<ExportResult> {
  return new Promise((resolve) => {
    const worker = new Worker(new URL("./export-worker.ts", import.meta.url), { type: "module" });
    const finish = (result: ExportResult) => {
      worker.terminate();
      resolve(result);
    };
    worker.onmessage = (event: MessageEvent<FromExportWorker>) => {
      const message = event.data;
      if (message.type === "done") finish(message.result);
      else finish({ ok: false, error: `The file could not be written: ${message.message}` });
    };
    worker.onerror = (event) => {
      event.preventDefault();
      finish({ ok: false, error: `The file writer stopped: ${event.message || "unknown error"}` });
    };
    const request: ToExportWorker = { type: "build", ...input, wasmBase: `${location.origin}/rhino3dm` };
    worker.postMessage(request);
  });
}
