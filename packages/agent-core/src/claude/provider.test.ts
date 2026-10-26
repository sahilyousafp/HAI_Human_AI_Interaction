import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { ClaudeCliSession } from "./provider.ts";

/** A `claude` process whose input pipe is already broken: a write to it fails with EPIPE, as when it has just exited. */
function brokenPipeProcess(): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  child.stdin = new Writable({
    write(_chunk, _encoding, done) {
      done(Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
    },
  });
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  Object.assign(child, { exitCode: null, pid: undefined });
  return child;
}

describe("ClaudeCliSession", () => {
  it("survives a write to a process that has just ended, as when Stop races its exit", async () => {
    const uncaught: unknown[] = [];
    const onUncaught = (error: unknown) => uncaught.push(error);
    process.on("uncaughtException", onUncaught);
    try {
      const child = brokenPipeProcess();
      const session = new ClaudeCliSession(child);
      const turn = session.send("build a wall")[Symbol.asyncIterator]();
      const next = turn.next();
      const stopped = session.interrupt();
      // The process ends while the stop is waiting for the turn to finish.
      setTimeout(() => child.emit("exit", 1), 20);
      await stopped;
      await next;
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(uncaught).toEqual([]);
    } finally {
      process.off("uncaughtException", onUncaught);
    }
  });
});
