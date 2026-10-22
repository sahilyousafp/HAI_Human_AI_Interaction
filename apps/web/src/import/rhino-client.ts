import type { ConvertResult } from "./convert.ts";
import type { FromImportWorker, ToImportWorker } from "./messages.ts";

export type ConvertStage = "loading" | "reading";

/**
 * Converts a `.3dm` file's bytes in a worker of its own, which is dropped afterwards so the reader's memory is
 * returned. `onStage` hears "loading" (the WebAssembly reader, the first time) and "reading".
 */
export function convertInWorker(
  bytes: ArrayBuffer,
  onStage: (stage: ConvertStage) => void,
): Promise<ConvertResult> {
  return new Promise((resolve) => {
    const worker = new Worker(new URL("./rhino-worker.ts", import.meta.url), { type: "module" });
    const finish = (result: ConvertResult) => {
      worker.terminate();
      resolve(result);
    };
    worker.onmessage = (event: MessageEvent<FromImportWorker>) => {
      const message = event.data;
      if (message.type === "stage") onStage(message.stage);
      else if (message.type === "done") finish(message.result);
      else finish({ ok: false, error: `The file could not be read: ${message.message}` });
    };
    worker.onerror = (event) => {
      event.preventDefault();
      finish({ ok: false, error: `The file reader stopped: ${event.message || "unknown error"}` });
    };
    const request: ToImportWorker = { type: "convert", bytes, wasmBase: `${location.origin}/rhino3dm` };
    worker.postMessage(request, [bytes]);
  });
}
