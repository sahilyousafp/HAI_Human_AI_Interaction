import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLogger } from "./log.ts";

const folder = () => mkdtempSync(join(tmpdir(), "hai-log-"));
const day = (iso: string) => () => new Date(iso);

describe("createLogger", () => {
  it("writes timestamped lines to a file for the day", () => {
    const dir = folder();
    const log = createLogger(dir, { now: day("2026-10-23T09:30:00.000Z") });
    log.info("[bridge] listening on http://127.0.0.1:4870");
    log.error("boom");
    expect(readdirSync(dir)).toEqual(["hai-2026-10-23.log"]);
    expect(readFileSync(join(dir, "hai-2026-10-23.log"), "utf8")).toBe(
      "2026-10-23T09:30:00.000Z INFO [bridge] listening on http://127.0.0.1:4870\n" +
        "2026-10-23T09:30:00.000Z ERROR boom\n",
    );
  });

  it("replaces a secret wherever it appears, in lines written after it was added", () => {
    const dir = folder();
    const log = createLogger(dir, { now: day("2026-10-23T09:30:00.000Z") });
    log.addSecret("tok-0123456789abcdef");
    log.info("connect ws://127.0.0.1:1/?t=tok-0123456789abcdef and tok-0123456789abcdef again");
    const text = readFileSync(join(dir, "hai-2026-10-23.log"), "utf8");
    expect(text).not.toContain("tok-0123456789abcdef");
    expect(text).toContain("connect ws://127.0.0.1:1/?t=[redacted] and [redacted] again");
  });

  it("ignores a secret too short to be one, so ordinary words are not blanked", () => {
    const dir = folder();
    const log = createLogger(dir, { now: day("2026-10-23T09:30:00.000Z") });
    log.addSecret("a");
    log.info("a plain line");
    expect(readFileSync(join(dir, "hai-2026-10-23.log"), "utf8")).toContain("a plain line");
  });

  it("keeps the last few day files and nothing else it did not write", () => {
    const dir = folder();
    for (const d of ["20", "21", "22", "23"]) writeFileSync(join(dir, `hai-2026-10-${d}.log`), "x");
    writeFileSync(join(dir, "notes.txt"), "keep me");
    createLogger(dir, { keep: 3 });
    expect(readdirSync(dir).sort()).toEqual(["hai-2026-10-22.log", "hai-2026-10-23.log", "notes.txt"]);
  });

  it("never throws when the folder cannot be written", () => {
    const dir = join(folder(), "a-file");
    writeFileSync(dir, "this is a file, not a folder");
    const log = createLogger(join(dir, "logs"));
    expect(() => log.info("dropped")).not.toThrow();
  });
});
