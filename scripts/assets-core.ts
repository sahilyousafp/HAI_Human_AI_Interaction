// The shared core of "place a pinned model file": check it against the SHA-256 in scripts/assets.lock.json, download it
// to a `.part` file that a later attempt continues, verify it, and only then move it into place. Used by
// scripts/fetch-assets.mjs (development) and by the desktop app's first-run download.
import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export interface ModelEntry {
  /** The path under the public folder, such as `models/kokoro/onnx/model.onnx`. */
  file: string;
  url: string;
  sha256: string;
  license: string;
  /** Downloaded on first run instead of shipping in the installer. */
  download?: boolean;
  /** The size in bytes, recorded for files that are downloaded so the first-run screen can show a total. */
  size?: number;
}

export type ModelState = "ok" | "missing" | "mismatch";

/** What came down did not match the pinned hash. The file is deleted; nothing wrong is ever placed. */
export class HashMismatchError extends Error {
  readonly file: string;
  readonly expected: string;
  readonly actual: string;
  constructor(file: string, expected: string, actual: string) {
    super(`${file}: the download's hash ${actual} does not match the pinned ${expected}`);
    this.file = file;
    this.expected = expected;
    this.actual = actual;
  }
}

/** The file could not be fetched (no connection, a server error, an interrupted transfer). A `.part` may be kept. */
export class DownloadError extends Error {
  readonly file: string;
  constructor(file: string, message: string, options?: { cause?: unknown }) {
    super(`${file}: ${message}`, options);
    this.file = file;
  }
}

export interface DownloadProgress {
  file: string;
  /** Bytes of the file on disk so far, including a part that was there before this attempt. */
  received: number;
  /** The file's full size, or null when the server did not say. */
  total: number | null;
}

export interface DownloadOptions {
  /** For tests. */
  fetch?: typeof fetch;
  onProgress?: (progress: DownloadProgress) => void;
  signal?: AbortSignal;
}

/** `present`: already there and verified. `resumed`: continued from a partial file. `downloaded`: fetched whole. */
export type DownloadResult = "present" | "downloaded" | "resumed";

export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

export async function modelState(dir: string, entry: ModelEntry): Promise<ModelState> {
  const target = join(dir, entry.file);
  if (!existsSync(target)) return "missing";
  return (await sha256File(target)) === entry.sha256 ? "ok" : "mismatch";
}

/** The entries that are downloaded on first run and are not yet in `dir`, verified. */
export async function missingDownloads(dir: string, entries: readonly ModelEntry[]): Promise<ModelEntry[]> {
  const missing: ModelEntry[] = [];
  for (const entry of entries) {
    if (entry.download && (await modelState(dir, entry)) !== "ok") missing.push(entry);
  }
  return missing;
}

const partSize = (part: string): number => (existsSync(part) ? statSync(part).size : 0);

/**
 * Places one model file in `dir`. A verified file is left alone; a wrong one is replaced. The download goes to
 * `<file>.part` and continues from there with a Range request after an interruption; it is hashed when complete and
 * renamed into place only if the hash matches, so a half or a corrupt file is never where a finished one is expected.
 */
export async function downloadModel(
  dir: string,
  entry: ModelEntry,
  options: DownloadOptions = {},
): Promise<DownloadResult> {
  const target = join(dir, entry.file);
  const part = `${target}.part`;
  const doFetch = options.fetch ?? fetch;

  if (existsSync(target)) {
    if ((await sha256File(target)) === entry.sha256) return "present";
    rmSync(target);
  }
  mkdirSync(dirname(target), { recursive: true });

  const request = async (offset: number): Promise<Response> => {
    try {
      return await doFetch(entry.url, {
        headers: offset > 0 ? { range: `bytes=${offset}-` } : {},
        signal: options.signal,
      });
    } catch (error) {
      throw new DownloadError(entry.file, `could not reach ${new URL(entry.url).host}`, { cause: error });
    }
  };

  let offset = partSize(part);
  let response = await request(offset);

  if (response.status === 416) {
    // The partial file is as long as the file, or longer. If it is the whole file, it is done; otherwise start over.
    if (offset > 0 && (await sha256File(part)) === entry.sha256) {
      renameSync(part, target);
      return "resumed";
    }
    rmSync(part, { force: true });
    offset = 0;
    response = await request(0);
  }
  if (!response.ok || !response.body) {
    throw new DownloadError(entry.file, `HTTP ${response.status} from ${new URL(entry.url).host}`);
  }

  // A server that ignores the Range header sends the whole file again (200): start the part over.
  const appending = response.status === 206 && offset > 0;
  if (!appending) offset = 0;
  const remaining = Number(response.headers.get("content-length"));
  const total = Number.isFinite(remaining) && remaining > 0 ? offset + remaining : (entry.size ?? null);

  let received = offset;
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      options.onProgress?.({ file: entry.file, received, total });
      callback(null, chunk);
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),
      counter,
      createWriteStream(part, { flags: appending ? "a" : "w" }),
      { signal: options.signal },
    );
  } catch (error) {
    // The part stays, so the next attempt continues from it.
    throw new DownloadError(entry.file, "the transfer was interrupted", { cause: error });
  }

  const actual = await sha256File(part);
  if (actual !== entry.sha256) {
    rmSync(part, { force: true });
    throw new HashMismatchError(entry.file, entry.sha256, actual);
  }
  renameSync(part, target);
  return appending ? "resumed" : "downloaded";
}
