import type { ModelItem, ModelsState } from "@hai/protocol";
import {
  DownloadError,
  downloadModel,
  HashMismatchError,
  type ModelEntry,
  missingDownloads,
} from "../../../../scripts/assets-core.ts";

export interface ModelsDownloaderOptions {
  /** The lock file's model entries; the ones flagged `download` are this downloader's business. */
  entries: readonly ModelEntry[];
  /** The folder the entries' paths are under: the app's user data folder, which holds `models/...`. */
  dir: string;
  /** For tests. */
  download?: typeof downloadModel;
  now?: () => number;
  /** The least time between two progress updates, so a fast download does not flood the page. */
  progressIntervalMs?: number;
}

export interface ModelsDownloader {
  /** Looks at the disk and updates the state (`ready` or `needed`). Does nothing while a download runs. */
  refresh(): Promise<void>;
  state(): ModelsState;
  /** Fetches what is missing, one file at a time. Safe to call again while running: it joins the run. */
  start(): Promise<void>;
  /** Stops the download in progress; the partial file stays for the next start. */
  cancel(): void;
  onChange(listener: (state: ModelsState) => void): () => void;
}

const failureReason = (error: unknown): "offline" | "server" | "rejected" => {
  if (error instanceof HashMismatchError) return "rejected";
  if (error instanceof DownloadError && /^.*: HTTP \d+/.test(error.message)) return "server";
  return "offline";
};

const describeFailure = (error: unknown): string => {
  if (error instanceof HashMismatchError) {
    return `${error.file} did not match its expected checksum and was discarded.`;
  }
  if (error instanceof DownloadError) return error.message;
  return error instanceof Error ? error.message : String(error);
};

/**
 * Fetches the voice models on first run. It checks each file against the pinned hash, continues partial files after an
 * interruption (the shared core in scripts/assets-core.ts does that), goes one file at a time and reports one state
 * for the page to show. It never runs two downloads at once.
 */
export function createModelsDownloader(options: ModelsDownloaderOptions): ModelsDownloader {
  const { entries, dir, download = downloadModel, now = Date.now, progressIntervalMs = 100 } = options;
  const listeners = new Set<(state: ModelsState) => void>();
  let current: ModelsState = { status: "checking" };
  let running: Promise<void> | null = null;
  let controller: AbortController | null = null;

  const set = (state: ModelsState) => {
    current = state;
    for (const listener of listeners) listener(state);
  };

  const sizeOf = (list: readonly ModelEntry[]) => list.reduce((sum, entry) => sum + (entry.size ?? 0), 0);
  /** The files grouped by the folder under models/ they are in, in order, for the screen to list. */
  const itemsOf = (list: readonly ModelEntry[]): ModelItem[] => {
    const items: ModelItem[] = [];
    for (const entry of list) {
      const id = entry.file.split("/")[1] ?? entry.file;
      const last = items.at(-1);
      if (last?.id === id) last.bytes += entry.size ?? 0;
      else items.push({ id, bytes: entry.size ?? 0 });
    }
    return items;
  };

  async function refresh(): Promise<void> {
    if (running) return;
    const missing = await missingDownloads(dir, entries);
    set(
      missing.length === 0
        ? { status: "ready" }
        : { status: "needed", files: missing.length, totalBytes: sizeOf(missing), items: itemsOf(missing) },
    );
  }

  async function run(): Promise<void> {
    const missing = await missingDownloads(dir, entries);
    if (missing.length === 0) {
      set({ status: "ready" });
      return;
    }
    const totalBytes = sizeOf(missing);
    controller = new AbortController();
    let doneBytes = 0;
    for (const [index, entry] of missing.entries()) {
      let lastEmit = 0;
      const base = { fileNumber: index + 1, fileCount: missing.length, totalBytes, items: itemsOf(missing) };
      set({ status: "downloading", file: entry.file, ...base, receivedBytes: doneBytes });
      try {
        await download(dir, entry, {
          signal: controller.signal,
          onProgress: (progress) => {
            const at = now();
            if (at - lastEmit < progressIntervalMs) return;
            lastEmit = at;
            set({
              status: "downloading",
              file: entry.file,
              ...base,
              receivedBytes: doneBytes + progress.received,
            });
          },
        });
      } catch (error) {
        if (controller.signal.aborted) {
          const rest = missing.slice(index);
          set({ status: "needed", files: rest.length, totalBytes: sizeOf(rest), items: itemsOf(rest) });
        } else {
          set({
            status: "failed",
            reason: failureReason(error),
            file: entry.file,
            message: describeFailure(error),
            files: missing.length - index,
            totalBytes: sizeOf(missing.slice(index)),
            receivedBytes: doneBytes,
            items: itemsOf(missing.slice(index)),
          });
        }
        return;
      }
      doneBytes += entry.size ?? 0;
    }
    set({ status: "ready" });
  }

  return {
    refresh,
    state: () => current,
    start() {
      if (!running) {
        running = run().finally(() => {
          running = null;
          controller = null;
        });
      }
      return running;
    },
    cancel() {
      controller?.abort();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
