import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { fakeProvider } from "../apps/bridge/test/fake-provider.ts";
import type { ModelsState } from "../packages/protocol/src/desktop.ts";
import { openSettings } from "./settings.ts";
import { startTestBridge } from "./viewer.ts";

// The first-run screen for the voice models. It belongs to the desktop app, so the page here gets a stand-in for the
// `window.haiDesktop` object the desktop app's preload script provides, and the test decides what the models' state is.

const ITEMS = [
  { id: "moonshine-small", bytes: 169_500_000 },
  { id: "kokoro", bytes: 326_600_000 },
];
const TOTAL = 496_100_000;

const needed: ModelsState = { status: "needed", files: 14, totalBytes: TOTAL, items: ITEMS };
const downloading = (receivedBytes: number): ModelsState => ({
  status: "downloading",
  file: "models/kokoro/onnx/model.onnx",
  fileNumber: 9,
  fileCount: 14,
  receivedBytes,
  totalBytes: TOTAL,
  items: ITEMS,
});
const failed = (reason: "offline" | "server" | "rejected"): ModelsState => ({
  status: "failed",
  reason,
  file: "models/kokoro/onnx/model.onnx",
  message: "x",
  files: 14,
  totalBytes: TOTAL,
  receivedBytes: 0,
  items: ITEMS,
});

type Fake = { set(state: ModelsState): void; calls: string[] };

let bridge: Awaited<ReturnType<typeof startTestBridge>> | null = null;
test.afterEach(async () => {
  await bridge?.stop();
  bridge = null;
});

/** A bridge with an agent that is there: without Claude Code on the machine the microphone is off for want of one. */
async function withAgent(page: Page) {
  bridge = await startTestBridge(page, {
    agent: fakeProvider(mkdtempSync(join(tmpdir(), "hai-e2e-first-run-"))),
  });
}

/** Gives the page a stand-in desktop app whose models state the test controls through `window.__fake`. */
async function installDesktop(page: Page, initial: ModelsState) {
  await page.addInitScript((first) => {
    let state = first;
    const listeners = new Set<(s: unknown) => void>();
    const calls: string[] = [];
    (window as unknown as { haiDesktop: unknown }).haiDesktop = {
      models: {
        state: async () => state,
        start: async () => void calls.push("start"),
        cancel: async () => void calls.push("cancel"),
        onChange: (listener: (s: unknown) => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
    };
    (window as unknown as { __fake: Fake }).__fake = {
      set(next) {
        state = next;
        for (const listener of listeners) listener(next);
      },
      calls,
    };
  }, initial);
}

const setState = (page: Page, state: ModelsState) =>
  page.evaluate((s) => (window as unknown as { __fake: Fake }).__fake.set(s), state);
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __fake: Fake }).__fake.calls);
const screen = (page: Page) => page.getByTestId("first-run");
const action = (page: Page, id: string) => page.getByTestId(`first-run-action-${id}`);

test.describe("not in a browser", () => {
  test("a plain browser has no desktop app, so the screen never shows", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("camera-toggle")).toBeVisible();
    expect(await page.evaluate(() => "haiDesktop" in window)).toBe(false);
    await expect(screen(page)).toHaveCount(0);
  });

  test("the desktop app with every model in place shows no screen", async ({ page }) => {
    await installDesktop(page, { status: "ready" });
    await page.goto("/");
    await expect(page.getByTestId("camera-toggle")).toBeVisible();
    await expect(screen(page)).toHaveCount(0);
  });

  test("while the desktop app is still looking at the disk, nothing shows yet", async ({ page }) => {
    await installDesktop(page, { status: "checking" });
    await page.goto("/");
    await expect(page.getByTestId("camera-toggle")).toBeVisible();
    await expect(screen(page)).toHaveCount(0);
  });
});

test.describe("voice models missing", () => {
  test("idle: lists what is needed with its size and offers to download or go on without", async ({
    page,
  }) => {
    await installDesktop(page, needed);
    await page.goto("/");
    await expect(screen(page)).toBeVisible();
    await expect(page.getByTestId("first-run-headline")).toHaveText("Download the voice models");
    await expect(page.getByTestId("first-run-detail")).toContainText("about 496 MB");
    await expect(page.getByTestId("first-run-item-moonshine-small")).toContainText("Speech to text");
    await expect(page.getByTestId("first-run-item-moonshine-small")).toContainText("170 MB");
    await expect(page.getByTestId("first-run-item-kokoro")).toContainText("Spoken replies");
    await expect(page.getByTestId("first-run-item-kokoro")).toContainText("327 MB");
    await expect(action(page, "download")).toBeFocused();
    await expect(action(page, "skip")).toHaveText("Continue without voice");
    await expect(page.getByTestId("first-run-progress")).toHaveCount(0);
  });

  test("Download asks the desktop app to start, and progress follows it", async ({ page }) => {
    await installDesktop(page, needed);
    await page.goto("/");
    await action(page, "download").click();
    expect(await calls(page)).toEqual(["start"]);

    await setState(page, downloading(248_050_000));
    await expect(page.getByTestId("first-run-headline")).toHaveText("Downloading the voice models");
    await expect(page.getByTestId("first-run-progress")).toHaveAttribute("aria-valuenow", "50");
    await expect(page.getByTestId("first-run-progress-label")).toHaveText("248 MB of 496 MB");
    await expect(page.getByTestId("first-run-item-moonshine-small")).toHaveAttribute("data-state", "done");
    await expect(page.getByTestId("first-run-item-kokoro")).toHaveAttribute("data-state", "active");

    await setState(page, downloading(300_000_000));
    await expect(page.getByTestId("first-run-progress")).toHaveAttribute("aria-valuenow", "60");
  });

  test("Continue lets the user in while the download carries on", async ({ page }) => {
    await installDesktop(page, downloading(50_000_000));
    await page.goto("/");
    await expect(page.getByTestId("first-run-headline")).toHaveText("Downloading the voice models");
    await action(page, "continue").click();
    await expect(screen(page)).toHaveCount(0);
    await expect(page.getByTestId("camera-toggle")).toBeVisible();
    expect(await calls(page)).toEqual([]); // continuing does not stop the download

    // It finishes in the background: the screen does not come back to announce it.
    await setState(page, { status: "ready" });
    await page.waitForTimeout(300);
    await expect(screen(page)).toHaveCount(0);
  });

  test("Stop download tells the desktop app to stop, and the screen offers to download again", async ({
    page,
  }) => {
    await installDesktop(page, downloading(50_000_000));
    await page.goto("/");
    await action(page, "cancel").click();
    expect(await calls(page)).toEqual(["cancel"]);
    await setState(page, needed);
    await expect(action(page, "download")).toBeVisible();
  });

  test("finishing while the screen is open says so", async ({ page }) => {
    await installDesktop(page, downloading(390_000_000));
    await page.goto("/");
    await setState(page, { status: "ready" });
    await expect(page.getByTestId("first-run-headline")).toHaveText("Voice is ready");
    await expect(action(page, "continue")).toBeFocused();
    await action(page, "continue").click();
    await expect(screen(page)).toHaveCount(0);
  });
});

test.describe("when the download fails", () => {
  test("offline: says the connection is the problem, and Try again starts it again", async ({ page }) => {
    await installDesktop(page, failed("offline"));
    await page.goto("/");
    await expect(page.getByTestId("first-run-headline")).toHaveText(
      "The voice models could not be downloaded",
    );
    await expect(page.getByTestId("first-run-detail")).toContainText("could not reach the internet");
    await expect(page.getByTestId("first-run-progress-label")).toHaveText("496 MB still to download");
    await expect(screen(page)).toHaveAttribute("data-tone", "problem");
    await action(page, "retry").click();
    expect(await calls(page)).toEqual(["start"]);
  });

  test("a damaged file is named", async ({ page }) => {
    await installDesktop(page, failed("rejected"));
    await page.goto("/");
    await expect(page.getByTestId("first-run-detail")).toContainText("models/kokoro/onnx/model.onnx");
  });

  test("Continue without voice is remembered, so the screen does not come back at the next launch", async ({
    page,
  }) => {
    await installDesktop(page, failed("offline"));
    await page.goto("/");
    await action(page, "skip").click();
    await expect(screen(page)).toHaveCount(0);

    await page.reload(); // the models are still missing
    await expect(page.getByTestId("camera-toggle")).toBeVisible();
    await expect(screen(page)).toHaveCount(0);
  });

  test("asking to download again clears that choice", async ({ page }) => {
    await installDesktop(page, needed);
    await page.goto("/");
    await action(page, "skip").click();
    await page.reload();
    await expect(screen(page)).toHaveCount(0);
    // The choice is stored; clearing it is what a later Download does.
    await page.evaluate(() => localStorage.removeItem("hai.setup.voiceSkipped"));
    await page.reload();
    await expect(screen(page)).toBeVisible();
    await action(page, "download").click();
    expect(await page.evaluate(() => localStorage.getItem("hai.setup.voiceSkipped"))).toBeNull();
  });
});

test.describe("the screen is a proper dialog", () => {
  test("it is modal, named by its headline, and its buttons can be pressed by hand", async ({ page }) => {
    await installDesktop(page, needed);
    await page.goto("/");
    const dialog = page.getByRole("dialog", { name: "Download the voice models" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    for (const id of ["download", "skip"]) await expect(action(page, id)).toHaveAttribute("data-hand-press");
  });
});

test.describe("the voice controls while the models are missing", () => {
  test("say so, show progress, and come alive when the models are in place, with no reload", async ({
    page,
  }) => {
    await withAgent(page);
    await installDesktop(page, needed);
    await page.goto("/");
    await action(page, "skip").click(); // go on without voice for now

    const pill = page.getByTestId("mic-indicator");
    const mic = page.getByTestId("mic-button");
    await expect(pill).toHaveAttribute("data-state", "missing");
    await expect(pill).toHaveText("Voice not downloaded");
    await expect(mic).toBeDisabled();
    await expect(mic).toHaveAttribute("aria-label", "Voice needs 496 MB of models");

    // The Voice page offers the download.
    await openSettings(page, "voice");
    await expect(page.getByTestId("settings-open-voice")).toBeHidden(); // on the page itself
    await page.getByTestId("voice-models-download").click();
    expect(await calls(page)).toEqual(["start"]);

    await setState(page, downloading(248_050_000));
    await expect(pill).toHaveAttribute("data-state", "preparing");
    await expect(pill).toHaveText("Voice downloading 50%");
    await expect(page.getByTestId("voice-models-progress")).toHaveText("50%");
    await expect(mic).toBeDisabled();

    await setState(page, { status: "ready" });
    await expect(pill).toHaveAttribute("data-state", "off");
    await expect(pill).toHaveText("Mic off");
    await expect(mic).toBeEnabled();
    await expect(page.getByTestId("voice-models-download")).toHaveCount(0);
    await expect(page.getByTestId("voice-models-progress")).toHaveCount(0);
  });

  test("a failed download says so on the pill and offers to try again", async ({ page }) => {
    await installDesktop(page, failed("offline"));
    await page.goto("/");
    await action(page, "skip").click();
    await expect(page.getByTestId("mic-indicator")).toHaveText("Voice download failed");
    await openSettings(page, "voice");
    await expect(page.getByTestId("voice-models-download")).toHaveText("Try again");
  });

  test("a browser has no such notice: the microphone is just the microphone", async ({ page }) => {
    // With an agent to talk to (without Claude Code on the machine the microphone is off for want of one).
    await withAgent(page);
    await page.goto("/");
    await expect(page.getByTestId("mic-indicator")).toHaveText("Mic off");
    await expect(page.getByTestId("mic-button")).toBeEnabled();
    await expect(page.getByTestId("mic-button")).toHaveAttribute("data-voice", "ready");
  });
});
