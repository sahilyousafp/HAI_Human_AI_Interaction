import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AppUpdater } from "../src/updates.ts";

// A stand-in for src/updates-deps.ts in the end-to-end tests: an updater that plays a release feed from files in
// FAKE_CLAUDE_STATE, so every update can be played without the network or a second version of the app.
//   update-available   a version number: a check finds that version (no file: the app is up to date)
//   update-fails       a message: the download fails verification with it
//   update-feed-down   a check cannot reach the feed
// The updater writes `download-started` when a download begins and `restart-requested` when it is asked to restart into the
// new version.
const dir = () => process.env.FAKE_CLAUDE_STATE ?? process.cwd();
const read = (name: string) =>
  existsSync(join(dir(), name)) ? readFileSync(join(dir(), name), "utf8").trim() : null;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class FakeUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  private found: string | null = null;

  async checkForUpdates(): Promise<void> {
    await sleep(150);
    if (existsSync(join(dir(), "update-feed-down"))) throw new Error("getaddrinfo ENOTFOUND github.com");
    this.found = read("update-available");
    if (this.found) this.emit("update-available", { version: this.found });
    else this.emit("update-not-available");
  }

  async downloadUpdate(): Promise<void> {
    mkdirSync(dir(), { recursive: true });
    writeFileSync(join(dir(), "download-started"), "1");
    for (const percent of [20, 55, 90]) {
      await sleep(150);
      this.emit("download-progress", { percent });
    }
    const failure = read("update-fails");
    if (failure) {
      const error = new Error(failure);
      this.emit("error", error);
      throw error;
    }
    this.emit("update-downloaded", { version: this.found });
  }

  quitAndInstall(): void {
    mkdirSync(dir(), { recursive: true });
    writeFileSync(join(dir(), "restart-requested"), "1");
  }
}

export const makeUpdater = (): AppUpdater | null => new FakeUpdater() as unknown as AppUpdater;
