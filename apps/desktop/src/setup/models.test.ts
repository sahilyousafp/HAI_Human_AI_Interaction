import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelsState } from "@hai/protocol";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ModelEntry } from "../../../../scripts/assets-core.ts";
import { createModelsDownloader } from "./models.ts";

const sha = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");
const bytes = (length: number, seed: number) =>
  Buffer.from(Array.from({ length }, (_, i) => (i * seed + (i >> 7)) % 251));

const CONTENT: Record<string, Buffer> = {
  "/shipped.task": bytes(50_000, 3),
  "/a.onnx": bytes(300_000, 5),
  "/b.bin": bytes(120_000, 7),
};

let server: Server;
let base: string;
let behaviour: "ok" | "error" | "corrupt" = "ok";
let requests: { path: string; range: string | null }[] = [];
let dir: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = req.url ?? "";
    requests.push({ path, range: req.headers.range ?? null });
    if (behaviour === "error") return void res.writeHead(503).end();
    const whole = CONTENT[path];
    if (!whole) return void res.writeHead(404).end();
    const body = behaviour === "corrupt" ? Buffer.alloc(whole.length, 1) : whole;
    const start = req.headers.range ? Number(/bytes=(\d+)-/.exec(req.headers.range)?.[1]) : 0;
    if (start >= body.length) return void res.writeHead(416).end();
    const slice = body.subarray(start);
    res.writeHead(start > 0 ? 206 : 200, { "content-length": slice.length });
    // In pieces, with a pause, so a download takes long enough to be stopped part way.
    let sent = 0;
    const timer = setInterval(() => {
      if (res.destroyed) return clearInterval(timer);
      const chunk = slice.subarray(sent, sent + 20_000);
      sent += chunk.length;
      res.write(chunk);
      if (sent >= slice.length) {
        clearInterval(timer);
        res.end();
      }
    }, 5);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  behaviour = "ok";
  requests = [];
  dir = mkdtempSync(join(tmpdir(), "hai-models-"));
});

const entry = (path: string, file: string, download = true): ModelEntry => ({
  file,
  url: `${base}${path}`,
  sha256: sha(CONTENT[path] as Buffer),
  license: "MIT",
  download,
  size: (CONTENT[path] as Buffer).length,
});
const entries = () => [
  entry("/shipped.task", "models/shipped.task", false),
  entry("/a.onnx", "models/voice/a.onnx"),
  entry("/b.bin", "models/voice/b.bin"),
];
const TOTAL = (CONTENT["/a.onnx"] as Buffer).length + (CONTENT["/b.bin"] as Buffer).length;

function recordStates(downloader: ReturnType<typeof createModelsDownloader>): ModelsState[] {
  const seen: ModelsState[] = [];
  downloader.onChange((state) => seen.push(state));
  return seen;
}

describe("createModelsDownloader", () => {
  it("starts as checking, and says what is to fetch once it has looked", async () => {
    const downloader = createModelsDownloader({ entries: entries(), dir });
    expect(downloader.state()).toEqual({ status: "checking" });
    await downloader.refresh();
    expect(downloader.state()).toEqual({
      status: "needed",
      files: 2,
      totalBytes: TOTAL,
      items: [{ id: "voice", bytes: TOTAL }], // both files are under models/voice/
    });
  });

  it("downloads the missing files one at a time, with progress, and ends ready", async () => {
    const downloader = createModelsDownloader({ entries: entries(), dir, progressIntervalMs: 0 });
    const seen = recordStates(downloader);
    await downloader.refresh();
    await downloader.start();

    expect(downloader.state()).toEqual({ status: "ready" });
    for (const [path, file] of [
      ["/a.onnx", "models/voice/a.onnx"],
      ["/b.bin", "models/voice/b.bin"],
    ] as const) {
      expect(readFileSync(join(dir, file)).equals(CONTENT[path] as Buffer)).toBe(true);
    }
    expect(existsSync(join(dir, "models", "shipped.task"))).toBe(false); // not flagged: not this downloader's
    expect(requests.map((r) => r.path)).toEqual(["/a.onnx", "/b.bin"]);

    const downloading = seen.filter((s) => s.status === "downloading");
    expect(downloading.some((s) => s.fileNumber === 1 && s.file === "models/voice/a.onnx")).toBe(true);
    expect(downloading.some((s) => s.fileNumber === 2 && s.file === "models/voice/b.bin")).toBe(true);
    expect(downloading.every((s) => s.fileCount === 2 && s.totalBytes === TOTAL)).toBe(true);
    const received = downloading.map((s) => (s.status === "downloading" ? s.receivedBytes : 0));
    expect(received).toEqual([...received].sort((a, b) => a - b)); // never goes back
    expect(received.at(-1)).toBeGreaterThan((CONTENT["/a.onnx"] as Buffer).length); // second file counted on top of the first
    expect(received.at(-1)).toBeLessThanOrEqual(TOTAL);
    expect(seen.at(-1)).toEqual({ status: "ready" });
  });

  it("limits how often progress is reported", async () => {
    const downloader = createModelsDownloader({
      entries: entries(),
      dir,
      now: () => 0, // the clock never moves, so no chunk is far enough after the last update
      progressIntervalMs: 1000,
    });
    const seen = recordStates(downloader);
    await downloader.start();
    // One update at the start of each file, none for the chunks in between.
    expect(seen.filter((s) => s.status === "downloading")).toHaveLength(2);
  });

  it("does nothing when every file is already in place", async () => {
    const downloader = createModelsDownloader({ entries: entries(), dir });
    await downloader.start();
    requests = [];
    await downloader.refresh();
    expect(downloader.state()).toEqual({ status: "ready" });
    await downloader.start();
    expect(requests).toEqual([]);
  });

  it("joins a run that is already going instead of starting a second one", async () => {
    const downloader = createModelsDownloader({ entries: entries(), dir });
    await Promise.all([downloader.start(), downloader.start()]);
    expect(requests.map((r) => r.path)).toEqual(["/a.onnx", "/b.bin"]);
  });

  it("reports that the host cannot be reached, and finishes when the connection is back", async () => {
    const offline = entries().map((e) => ({ ...e, url: e.url.replace(base, "http://127.0.0.1:1") }));
    const downloader = createModelsDownloader({ entries: offline, dir });
    await downloader.start();
    const state = downloader.state();
    expect(state.status).toBe("failed");
    if (state.status !== "failed") return;
    expect(state.reason).toBe("offline");
    expect(state.file).toBe("models/voice/a.onnx");
    expect(state.files).toBe(2);
    expect(state.totalBytes).toBe(TOTAL);
    expect(existsSync(join(dir, "models", "voice", "a.onnx"))).toBe(false);

    const online = createModelsDownloader({ entries: entries(), dir });
    await online.start();
    expect(online.state()).toEqual({ status: "ready" });
  });

  it("reports a server error", async () => {
    behaviour = "error";
    const downloader = createModelsDownloader({ entries: entries(), dir });
    await downloader.start();
    const state = downloader.state();
    expect(state).toMatchObject({ status: "failed", reason: "server", file: "models/voice/a.onnx" });
  });

  it("rejects a file with the wrong hash, names it, and places nothing", async () => {
    behaviour = "corrupt";
    const downloader = createModelsDownloader({ entries: entries(), dir });
    await downloader.start();
    const state = downloader.state();
    expect(state).toMatchObject({ status: "failed", reason: "rejected", file: "models/voice/a.onnx" });
    if (state.status === "failed") expect(state.message).toContain("models/voice/a.onnx");
    expect(existsSync(join(dir, "models", "voice", "a.onnx"))).toBe(false);
    expect(existsSync(join(dir, "models", "voice", "a.onnx.part"))).toBe(false);
  });

  it("keeps what failed files left and counts only the files still to fetch", async () => {
    const downloader = createModelsDownloader({ entries: entries(), dir });
    await downloader.start();
    // b.bin fails on a later attempt: only a.onnx is in place, so one file remains.
    const second = createModelsDownloader({
      entries: [
        entry("/a.onnx", "models/voice/a.onnx"),
        { ...entry("/b.bin", "models/voice/c.bin"), url: "http://127.0.0.1:1/c.bin" },
      ],
      dir,
    });
    await second.start();
    expect(second.state()).toMatchObject({ status: "failed", reason: "offline", files: 1 });
  });

  it("stops when asked, keeps the partial file, and the next start continues it", async () => {
    const downloader = createModelsDownloader({ entries: entries(), dir, progressIntervalMs: 0 });
    let stopped = false;
    downloader.onChange((state) => {
      // Part way through the first file, once some of it has been written to disk.
      if (!stopped && state.status === "downloading" && state.receivedBytes > 100_000) {
        stopped = true;
        downloader.cancel();
      }
    });
    await downloader.start();
    expect(stopped).toBe(true);
    expect(downloader.state()).toMatchObject({ status: "needed", files: 2 });
    const part = join(dir, "models", "voice", "a.onnx.part");
    expect(existsSync(part)).toBe(true);
    const kept = readFileSync(part).length;
    expect(kept).toBeGreaterThan(0);

    requests = [];
    await downloader.start();
    expect(downloader.state()).toEqual({ status: "ready" });
    expect(requests[0]).toEqual({ path: "/a.onnx", range: `bytes=${kept}-` });
    expect(readFileSync(join(dir, "models", "voice", "a.onnx")).equals(CONTENT["/a.onnx"] as Buffer)).toBe(
      true,
    );
  });
});
