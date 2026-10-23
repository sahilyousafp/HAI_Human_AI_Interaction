import { EventEmitter } from "node:events";
import type { UpdateState } from "@hai/protocol";
import { describe, expect, it, vi } from "vitest";
import { type AppUpdater, createUpdates, type UpdatesOptions } from "./updates.ts";

/** A stand-in for electron-updater that the test drives: it answers a check or a download as it is told to. */
function fakeUpdater() {
  const events = new EventEmitter();
  const calls: string[] = [];
  const script = {
    check: async () => {
      calls.push("check");
    },
    download: async () => {
      calls.push("download");
    },
  };
  const updater = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    checkForUpdates: () => script.check(),
    downloadUpdate: () => script.download(),
    quitAndInstall: (silent?: boolean, forceRun?: boolean) => {
      calls.push(`quitAndInstall(${silent},${forceRun})`);
    },
    on: (event: string, listener: (...args: unknown[]) => void) => events.on(event, listener),
  } as unknown as AppUpdater;
  return { updater, events, calls, script };
}

function make(over: Partial<UpdatesOptions> = {}) {
  const fake = fakeUpdater();
  const seen: UpdateState[] = [];
  const beforeRestart = vi.fn(async () => {});
  const timers: { fn: () => void; ms: number }[] = [];
  const updates = createUpdates({
    updater: fake.updater,
    current: "1.0.0",
    autoCheck: true,
    beforeRestart,
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimer: (handle) => {
      timers[(handle as number) - 1] = { fn: () => {}, ms: -1 };
    },
    ...over,
  });
  updates.onChange((s) => seen.push(s));
  return { ...fake, updates, seen, beforeRestart, timers };
}
const statuses = (seen: UpdateState[]) => seen.map((s) => s.status);

describe("an app that cannot update", () => {
  it("says so, and never looks, when it is running from the repository", async () => {
    const { updates, calls } = (() => {
      const u = createUpdates({
        updater: null,
        current: "0.0.0",
        autoCheck: true,
        beforeRestart: async () => {},
      });
      return { updates: u, calls: [] as string[] };
    })();
    expect(updates.state()).toEqual({ current: "0.0.0", autoCheck: true, status: "unavailable" });
    updates.start();
    await updates.check();
    await updates.download();
    expect(await updates.restart()).toBe(false);
    expect(updates.state().status).toBe("unavailable");
    expect(calls).toEqual([]);
  });
});

describe("the safe defaults", () => {
  it("never downloads or installs by itself", () => {
    const { updater } = make();
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
  });
});

describe("checking", () => {
  it("finds a newer version and offers it, with what is running now", async () => {
    const { updates, events, script, seen } = make();
    script.check = async () => void events.emit("update-available", { version: "1.1.0" });
    await updates.check();
    expect(statuses(seen)).toEqual(["checking", "available"]);
    expect(updates.state()).toEqual({
      current: "1.0.0",
      autoCheck: true,
      status: "available",
      version: "1.1.0",
    });
  });

  it("says when it is up to date, and when it looked", async () => {
    let clock = Date.parse("2026-10-23T10:00:00.000Z");
    const { updates, events, script } = make({ now: () => clock });
    script.check = async () => void events.emit("update-not-available");
    await updates.check();
    expect(updates.state()).toMatchObject({ status: "idle", checkedAt: "2026-10-23T10:00:00.000Z" });
    clock += 1;
  });

  it("joins a check that is already running instead of starting another", async () => {
    const { updates, calls, script, events } = make();
    script.check = async () => {
      calls.push("check");
      await new Promise((r) => setTimeout(r, 20));
      events.emit("update-not-available");
    };
    await Promise.all([updates.check(), updates.check(), updates.check()]);
    expect(calls.filter((c) => c === "check")).toHaveLength(1);
  });

  it("shows why a check the user asked for failed", async () => {
    const { updates, script } = make();
    script.check = async () => {
      throw new Error("getaddrinfo ENOTFOUND github.com");
    };
    await updates.check();
    expect(updates.state()).toMatchObject({ status: "error" });
    expect((updates.state() as { message: string }).message).toContain("Could not look for updates");
  });

  it("does not take away an update that was already found", async () => {
    const { updates, events, script, calls } = make();
    script.check = async () => void events.emit("update-available", { version: "1.1.0" });
    await updates.check();
    calls.length = 0;
    await updates.check();
    expect(updates.state()).toMatchObject({ status: "available", version: "1.1.0" });
    expect(calls).toEqual([]);
  });
});

describe("automatic checks", () => {
  it("check on start and then once a day, when they are on", async () => {
    const { updates, calls, timers } = make();
    updates.start();
    await vi.waitFor(() => expect(updates.state().status).toBe("idle")); // the first check has finished
    expect(calls).toEqual(["check"]);
    expect(timers).toHaveLength(1);
    expect(timers[0]?.ms).toBe(24 * 60 * 60 * 1000);
    timers[0]?.fn();
    await vi.waitFor(() => expect(calls.filter((c) => c === "check")).toHaveLength(2));
  });

  it("do nothing when the user turned them off, but a check they ask for still runs", async () => {
    const { updates, calls, timers } = make({ autoCheck: false });
    updates.start();
    await Promise.resolve();
    expect(calls).toEqual([]);
    expect(timers).toEqual([]);
    await updates.check();
    expect(calls).toEqual(["check"]);
  });

  it("stay quiet when they cannot reach the feed: no error is shown for a check nobody asked for", async () => {
    const { updates, script, seen } = make();
    script.check = async () => {
      throw new Error("offline");
    };
    updates.start();
    await vi.waitFor(() => expect(updates.state().status).toBe("idle"));
    expect(statuses(seen)).not.toContain("error");
  });

  it("start and stop with the switch", async () => {
    const { updates, calls, timers } = make({ autoCheck: false });
    updates.start();
    updates.setAutoCheck(true);
    await Promise.resolve();
    expect(calls).toEqual(["check"]);
    expect(timers.filter((t) => t.ms > 0)).toHaveLength(1);
    expect(updates.state().autoCheck).toBe(true);
    updates.setAutoCheck(false);
    expect(timers.filter((t) => t.ms > 0)).toHaveLength(0);
    expect(updates.state().autoCheck).toBe(false);
  });
});

describe("downloading", () => {
  async function available() {
    const made = make();
    made.script.check = async () => void made.events.emit("update-available", { version: "1.1.0" });
    await made.updates.check();
    return made;
  }

  it("only starts when the user asks for it, and not before an update was found", async () => {
    const { updates, calls } = make();
    await updates.download();
    expect(calls).toEqual([]);
    const found = await available();
    expect(found.calls).toEqual([]); // finding it downloaded nothing
  });

  it("shows progress, then that it is ready", async () => {
    const { updates, events, script, seen } = await available();
    script.download = async () => {
      events.emit("download-progress", { percent: 31.6 });
      events.emit("download-progress", { percent: 80 });
      events.emit("update-downloaded", { version: "1.1.0" });
    };
    await updates.download();
    const downloading = seen.filter((s) => s.status === "downloading");
    expect(downloading.map((s) => (s as { percent: number }).percent)).toEqual([0, 32, 80]);
    expect(updates.state()).toMatchObject({ status: "ready", version: "1.1.0", canRestart: true });
  });

  it("refuses a download that does not verify: the update is discarded and the installed version is said to be fine", async () => {
    const { updates, events, script } = await available();
    script.download = async () => {
      events.emit("error", new Error("sha512 checksum mismatch"));
      throw new Error("sha512 checksum mismatch");
    };
    await updates.download();
    const state = updates.state();
    expect(state.status).toBe("error");
    if (state.status !== "error") return;
    expect(state.message).toContain("sha512 checksum mismatch");
    expect(state.message).toContain("HAI 1.0.0 is still installed and works as before");
    expect(await updates.restart()).toBe(false);
  });

  it("can be tried again after a failure", async () => {
    const { updates, events, script, calls } = await available();
    script.download = async () => {
      throw new Error("connection reset");
    };
    await updates.download();
    expect(updates.state().status).toBe("error");
    script.check = async () => void events.emit("update-available", { version: "1.1.0" });
    await updates.check();
    expect(updates.state().status).toBe("available");
    script.download = async () => {
      calls.push("download");
      events.emit("update-downloaded", { version: "1.1.0" });
    };
    await updates.download();
    expect(updates.state().status).toBe("ready");
  });
});

describe("restarting", () => {
  async function ready(busy = false) {
    const made = make();
    made.script.check = async () => void made.events.emit("update-available", { version: "1.1.0" });
    made.script.download = async () => void made.events.emit("update-downloaded", { version: "1.1.0" });
    if (busy) made.updates.setBusy(true);
    await made.updates.check();
    await made.updates.download();
    return made;
  }

  it("ends the bridge and its agents first, then replaces the program and starts it again", async () => {
    const { updates, calls, beforeRestart } = await ready();
    expect(await updates.restart()).toBe(true);
    expect(beforeRestart).toHaveBeenCalledOnce();
    expect(calls.at(-1)).toBe("quitAndInstall(false,true)");
    expect(beforeRestart.mock.invocationCallOrder[0]).toBeLessThan(
      vi.fn().mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it("waits while an agent turn is running, and offers the restart when it ends", async () => {
    const { updates, calls, beforeRestart, seen } = await ready(true);
    expect(updates.state()).toMatchObject({ status: "ready", canRestart: false });
    expect(await updates.restart()).toBe(false);
    expect(beforeRestart).not.toHaveBeenCalled();
    expect(calls.some((c) => c.startsWith("quitAndInstall"))).toBe(false);

    updates.setBusy(false);
    expect(updates.state()).toMatchObject({ status: "ready", canRestart: true });
    expect(seen.at(-1)).toMatchObject({ status: "ready", canRestart: true });
    expect(await updates.restart()).toBe(true);
  });

  it("takes the restart back when a new turn starts after it was offered", async () => {
    const { updates } = await ready();
    updates.setBusy(true);
    expect(updates.state()).toMatchObject({ canRestart: false });
    expect(await updates.restart()).toBe(false);
  });

  it("does nothing when no update is ready", async () => {
    const { updates, calls } = make();
    expect(await updates.restart()).toBe(false);
    expect(calls).toEqual([]);
  });

  it("does not report a change for a busy flag that changes nothing", async () => {
    const { updates, seen } = await ready();
    const before = seen.length;
    updates.setBusy(false);
    expect(seen.length).toBe(before);
  });
});
