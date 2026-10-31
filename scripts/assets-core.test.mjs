import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  DownloadError,
  downloadModel,
  HashMismatchError,
  missingDownloads,
  modelState,
  sha256File,
} from "./assets-core.ts";

const sha = (buffer) => createHash("sha256").update(buffer).digest("hex");
// Large enough to arrive in several chunks.
const CONTENT = Buffer.from(Array.from({ length: 300_000 }, (_, i) => (i * 31 + (i >> 8)) % 251));

let server;
let url;
let mode;
/** One entry per request the server answered: its Range header and what it sent. */
let requests;
let dir;

beforeAll(async () => {
  server = createServer((req, res) => {
    const range = req.headers.range;
    requests.push({ range: range ?? null });
    if (mode === "error") {
      res.writeHead(503).end("busy");
      return;
    }
    const body = mode === "corrupt" ? Buffer.alloc(CONTENT.length, 7) : CONTENT;
    const start = range && mode !== "ignore-range" ? Number(/bytes=(\d+)-/.exec(range)?.[1]) : 0;
    if (start >= body.length) {
      res.writeHead(416, { "content-range": `bytes */${body.length}` }).end();
      return;
    }
    const slice = body.subarray(start);
    res.writeHead(start > 0 ? 206 : 200, { "content-length": slice.length });
    if (mode === "drop") {
      // Sends part of the rest, then breaks the connection.
      res.write(slice.subarray(0, Math.floor(slice.length / 2)));
      setTimeout(() => res.destroy(), 20);
      return;
    }
    res.end(slice);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${server.address().port}/model.bin`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  mode = "ok";
  requests = [];
  dir = mkdtempSync(join(tmpdir(), "hai-assets-"));
});

const entry = (extra = {}) => ({
  file: "models/x/model.bin",
  url,
  sha256: sha(CONTENT),
  license: "MIT",
  ...extra,
});
const target = () => join(dir, "models", "x", "model.bin");
const files = () => (existsSync(join(dir, "models", "x")) ? readdirSync(join(dir, "models", "x")) : []);

describe("modelState", () => {
  it("says whether a file is there and matches its pinned hash", async () => {
    expect(await modelState(dir, entry())).toBe("missing");
    mkdirSync(join(dir, "models", "x"), { recursive: true });
    writeFileSync(target(), "something else");
    expect(await modelState(dir, entry())).toBe("mismatch");
    writeFileSync(target(), CONTENT);
    expect(await modelState(dir, entry())).toBe("ok");
  });
});

describe("downloadModel", () => {
  it("downloads a file, verifies it and reports progress up to its full size", async () => {
    const progress = [];
    const result = await downloadModel(dir, entry(), { onProgress: (p) => progress.push(p) });
    expect(result).toBe("downloaded");
    expect(readFileSync(target()).equals(CONTENT)).toBe(true);
    expect(files()).toEqual(["model.bin"]); // no .part left behind
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.at(-1)).toEqual({
      file: "models/x/model.bin",
      received: CONTENT.length,
      total: CONTENT.length,
    });
  });

  it("leaves a verified file alone and makes no request", async () => {
    await downloadModel(dir, entry());
    requests = [];
    expect(await downloadModel(dir, entry())).toBe("present");
    expect(requests).toEqual([]);
  });

  it("replaces a file that does not match", async () => {
    mkdirSync(join(dir, "models", "x"), { recursive: true });
    writeFileSync(target(), "an old version");
    expect(await downloadModel(dir, entry())).toBe("downloaded");
    expect(readFileSync(target()).equals(CONTENT)).toBe(true);
  });

  it("rejects a download whose hash does not match, deletes it, and never places it", async () => {
    mode = "corrupt";
    const error = await downloadModel(dir, entry()).catch((e) => e);
    expect(error).toBeInstanceOf(HashMismatchError);
    expect(error.file).toBe("models/x/model.bin");
    expect(error.expected).toBe(sha(CONTENT));
    expect(error.actual).toBe(sha(Buffer.alloc(CONTENT.length, 7)));
    expect(files()).toEqual([]);
  });

  it("continues from a partial file and requests only the rest", async () => {
    const half = Math.floor(CONTENT.length / 2);
    mkdirSync(join(dir, "models", "x"), { recursive: true });
    writeFileSync(`${target()}.part`, CONTENT.subarray(0, half));
    const progress = [];
    expect(await downloadModel(dir, entry(), { onProgress: (p) => progress.push(p) })).toBe("resumed");
    expect(requests).toEqual([{ range: `bytes=${half}-` }]);
    expect(readFileSync(target()).equals(CONTENT)).toBe(true);
    expect(files()).toEqual(["model.bin"]);
    expect(progress[0].received).toBeGreaterThan(half); // counted from where it continued
    expect(progress.at(-1)).toEqual({
      file: "models/x/model.bin",
      received: CONTENT.length,
      total: CONTENT.length,
    });
  });

  it("starts over when the server ignores the Range request", async () => {
    mode = "ignore-range";
    mkdirSync(join(dir, "models", "x"), { recursive: true });
    writeFileSync(`${target()}.part`, CONTENT.subarray(0, 1000));
    expect(await downloadModel(dir, entry())).toBe("downloaded");
    expect(readFileSync(target()).equals(CONTENT)).toBe(true);
  });

  it("accepts a partial file that is already the whole file", async () => {
    mkdirSync(join(dir, "models", "x"), { recursive: true });
    writeFileSync(`${target()}.part`, CONTENT);
    expect(await downloadModel(dir, entry())).toBe("resumed");
    expect(readFileSync(target()).equals(CONTENT)).toBe(true);
    expect(files()).toEqual(["model.bin"]);
  });

  it("throws away a partial file that is longer than the file and downloads it again", async () => {
    mkdirSync(join(dir, "models", "x"), { recursive: true });
    writeFileSync(`${target()}.part`, Buffer.concat([CONTENT, Buffer.from("extra")]));
    expect(await downloadModel(dir, entry())).toBe("downloaded");
    expect(readFileSync(target()).equals(CONTENT)).toBe(true);
  });

  it("keeps what arrived when the transfer breaks, and the next attempt continues from it", async () => {
    mode = "drop";
    const error = await downloadModel(dir, entry()).catch((e) => e);
    expect(error).toBeInstanceOf(DownloadError);
    expect(existsSync(target())).toBe(false);
    const kept = readFileSync(`${target()}.part`).length;
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan(CONTENT.length);

    mode = "ok";
    requests = [];
    expect(await downloadModel(dir, entry())).toBe("resumed");
    expect(requests).toEqual([{ range: `bytes=${kept}-` }]);
    expect(readFileSync(target()).equals(CONTENT)).toBe(true);
  });

  it("reports an unreachable host and leaves nothing behind", async () => {
    const unreachable = entry({ url: "http://127.0.0.1:1/model.bin" });
    const error = await downloadModel(dir, unreachable).catch((e) => e);
    expect(error).toBeInstanceOf(DownloadError);
    expect(error.message).toContain("could not reach 127.0.0.1:1");
    expect(files()).toEqual([]);
  });

  it("reports a server error with its status", async () => {
    mode = "error";
    const error = await downloadModel(dir, entry()).catch((e) => e);
    expect(error).toBeInstanceOf(DownloadError);
    expect(error.message).toContain("HTTP 503");
  });

  it("stops when asked to, keeping the partial file", async () => {
    const controller = new AbortController();
    const error = await downloadModel(dir, entry(), {
      signal: controller.signal,
      onProgress: () => controller.abort(),
    }).catch((e) => e);
    expect(error).toBeInstanceOf(DownloadError);
    expect(existsSync(target())).toBe(false);
  });
});

describe("missingDownloads", () => {
  it("lists the entries flagged for download that are not in place and verified", async () => {
    const shipped = entry({ file: "models/shipped.bin" });
    const there = entry({ file: "models/there.bin", download: true });
    const absent = entry({ file: "models/absent.bin", download: true });
    const wrong = entry({ file: "models/wrong.bin", download: true });
    mkdirSync(join(dir, "models"), { recursive: true });
    writeFileSync(join(dir, "models", "there.bin"), CONTENT);
    writeFileSync(join(dir, "models", "wrong.bin"), "nope");
    const missing = await missingDownloads(dir, [shipped, there, absent, wrong]);
    expect(missing.map((m) => m.file)).toEqual(["models/absent.bin", "models/wrong.bin"]);
  });
});

describe("sha256File", () => {
  it("hashes a file without reading it whole", async () => {
    mkdirSync(join(dir, "models"), { recursive: true });
    writeFileSync(join(dir, "models", "a.bin"), CONTENT);
    expect(await sha256File(join(dir, "models", "a.bin"))).toBe(sha(CONTENT));
  });
});

describe("the lock file", () => {
  const lock = JSON.parse(readFileSync(join(import.meta.dirname, "assets.lock.json"), "utf8"));

  it("flags exactly the voice models for download, each with its size", () => {
    const downloaded = lock.models.filter((m) => m.download).map((m) => m.file);
    expect(downloaded.length).toBeGreaterThan(0);
    for (const file of downloaded) expect(file).toMatch(/^models\/(kokoro|moonshine-small)\//);
    for (const m of lock.models) {
      if (/^models\/(kokoro|moonshine-small)\//.test(m.file)) {
        expect(m.download).toBe(true);
        expect(m.size).toBeGreaterThan(0);
      } else {
        expect(m.download).toBeUndefined(); // the tracking models ship in the installer
      }
    }
  });
});

describe("fetch-assets --shipped-only", () => {
  it("checks only the files the installer carries, so a release build does not need the voice models", async () => {
    const { spawnSync } = await import("node:child_process");
    const script = join(import.meta.dirname, "fetch-assets.mjs");
    const run = spawnSync(process.execPath, [script, "--check", "--shipped-only"], { encoding: "utf8" });
    // Every shipped model is listed; no downloaded one is.
    expect(run.stdout + run.stderr).toContain("models/hand_landmarker.task");
    expect(run.stdout + run.stderr).not.toMatch(/models\/(kokoro|moonshine-small)\//);
  });
});
