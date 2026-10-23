import { expect, type Page, test } from "@playwright/test";
import type { UpdateState } from "../packages/protocol/src/desktop.ts";
import { openSettings } from "./settings.ts";

// The update controls: the pill in the top bar and the Updates group in Settings > Setup. The page gets a stand-in for the
// `window.haiDesktop` object the desktop app's preload script provides, and the test decides where updating stands.

const state = (rest: object): UpdateState => ({ current: "1.0.0", autoCheck: true, ...rest }) as UpdateState;
const IDLE = state({ status: "idle", checkedAt: null });

type Fake = { set(next: UpdateState): void; calls: string[] };

async function installDesktop(page: Page, initial: UpdateState) {
  await page.addInitScript((first) => {
    let current = first;
    const listeners = new Set<(s: unknown) => void>();
    const calls: string[] = [];
    const ready = { status: "ready" };
    (window as unknown as { haiDesktop: unknown }).haiDesktop = {
      // Nothing for the first-run screens to ask: Claude Code and the voice models are in place.
      models: {
        state: async () => ready,
        start: async () => {},
        cancel: async () => {},
        onChange: () => () => {},
      },
      claude: {
        state: async () => ({
          state: { status: "ready", version: "2.1.303" },
          prerequisites: [],
          info: { command: "", source: "", instructionsUrl: "" },
        }),
        recheck: async () => ({}),
        install: async () => {},
        openSignIn: async () => {},
        onChange: () => () => {},
      },
      updates: {
        state: async () => current,
        check: async () => void calls.push("check"),
        download: async () => void calls.push("download"),
        restart: async () => {
          calls.push("restart");
          return true;
        },
        setBusy: async (busy: boolean) => void calls.push(`busy:${busy}`),
        setAutoCheck: async (on: boolean) => void calls.push(`auto:${on}`),
        onChange: (l: (s: unknown) => void) => {
          listeners.add(l);
          return () => listeners.delete(l);
        },
      },
    };
    (window as unknown as { __fake: Fake }).__fake = {
      set(next) {
        current = next;
        for (const l of listeners) l(next);
      },
      calls,
    };
  }, initial);
}

const setState = (page: Page, next: UpdateState) =>
  page.evaluate((s) => (window as unknown as { __fake: Fake }).__fake.set(s), next);
const everyCall = (page: Page) => page.evaluate(() => (window as unknown as { __fake: Fake }).__fake.calls);
/** What the user asked for: the page's own reports of whether the agent is busy are left out. */
const calls = async (page: Page) => (await everyCall(page)).filter((call) => !call.startsWith("busy:"));
const pill = (page: Page) => page.getByTestId("update-pill");
const summary = (page: Page) => page.getByTestId("update-summary");

test.describe("not in the desktop app", () => {
  test("a browser has no update pill and no Updates settings", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("camera-toggle")).toBeVisible();
    await expect(pill(page)).toHaveCount(0);
    await page.getByTestId("settings-button").click();
    await expect(page.getByTestId("settings-open-camera")).toBeVisible();
    await expect(page.getByTestId("settings-open-setup")).toHaveCount(0);
  });
});

test.describe("the Updates group", () => {
  test("shows the version that is running and offers to check, with no pill while there is nothing to act on", async ({
    page,
  }) => {
    await installDesktop(page, IDLE);
    await page.goto("/");
    await expect(pill(page)).toHaveCount(0);
    await openSettings(page, "setup");
    await expect(page.getByTestId("setup-updates")).toContainText("Version 1.0.0");
    await expect(summary(page)).toHaveText("Not checked yet");
    await expect(page.getByTestId("update-check")).toHaveText("Check for updates");
    await page.getByTestId("update-check").click();
    expect(await calls(page)).toEqual(["check"]);

    await setState(page, state({ status: "checking" }));
    await expect(summary(page)).toHaveText("Looking for updates");
    await expect(page.getByTestId("update-check")).toBeDisabled();

    await setState(page, state({ status: "idle", checkedAt: "2026-10-23T10:00:00.000Z" }));
    await expect(summary(page)).toHaveText("You have the latest version");
  });

  test("tells the user about a new version, downloads only when asked, and shows progress", async ({
    page,
  }) => {
    await installDesktop(page, IDLE);
    await page.goto("/");
    await setState(page, state({ status: "available", version: "1.1.0" }));

    // The top bar says so; nothing has been downloaded.
    await expect(pill(page)).toHaveText("Update 1.1.0 available");
    expect(await calls(page)).toEqual([]);

    // The pill opens the Setup page directly.
    await pill(page).click();
    await expect(page.getByTestId("settings-page-setup")).toBeVisible();
    await expect(summary(page)).toHaveText("Version 1.1.0 is available");
    await expect(page.getByTestId("update-detail")).toContainText("You have 1.0.0");

    await page.getByTestId("update-download").click();
    expect(await calls(page)).toEqual(["download"]);

    await setState(page, state({ status: "downloading", version: "1.1.0", percent: 42 }));
    await expect(summary(page)).toHaveText("Downloading version 1.1.0, 42%");
    await expect(page.getByTestId("update-progress").getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "42",
    );
    await expect(pill(page)).toHaveText("Downloading update 42%");
    await expect(page.getByTestId("update-download")).toHaveCount(0); // nothing to press while it downloads
  });

  test("offers the restart when the update is ready, and asks the app to do it when pressed", async ({
    page,
  }) => {
    await installDesktop(page, state({ status: "ready", version: "1.1.0", canRestart: true }));
    await page.goto("/");
    await expect(pill(page)).toHaveText("Restart to update");
    await openSettings(page, "setup");
    await expect(summary(page)).toHaveText("Version 1.1.0 is ready");
    await expect(page.getByTestId("update-detail")).toContainText("Your work is kept");
    await page.getByTestId("update-restart").click();
    expect(await calls(page)).toEqual(["restart"]);
  });

  test("holds the restart while the agent is working, says why, and frees it when the turn ends", async ({
    page,
  }) => {
    await installDesktop(page, state({ status: "ready", version: "1.1.0", canRestart: false }));
    await page.goto("/");
    await expect(pill(page)).toHaveText("Update ready");
    await openSettings(page, "setup");
    const restart = page.getByTestId("update-restart");
    await expect(restart).toBeDisabled();
    await expect(restart).toHaveText("Restart when the agent finishes");
    await expect(page.getByTestId("update-detail")).toContainText("The agent is working");

    await setState(page, state({ status: "ready", version: "1.1.0", canRestart: true }));
    await expect(restart).toBeEnabled();
    await expect(restart).toHaveText("Restart to update");
  });

  test("shows why an update failed, in the app's own words, and offers another try", async ({ page }) => {
    const message =
      "The update could not be installed: sha512 checksum mismatch. HAI 1.0.0 is still installed and works as before.";
    await installDesktop(page, state({ status: "error", message }));
    await page.goto("/");
    await openSettings(page, "setup");
    await expect(summary(page)).toHaveText("Something went wrong");
    await expect(page.getByTestId("update-detail")).toHaveText(message);
    await expect(summary(page)).toHaveAttribute("data-tone", "problem");
    await page.getByTestId("update-check").click();
    expect(await calls(page)).toEqual(["check"]);
    await expect(pill(page)).toHaveCount(0); // a failure is explained where the user looks, not in the top bar
  });

  test("the automatic-check switch is on by default and tells the app when it is turned off", async ({
    page,
  }) => {
    await installDesktop(page, IDLE);
    await page.goto("/");
    await openSettings(page, "setup");
    const auto = page.getByTestId("update-auto");
    await expect(auto).toBeChecked();
    await auto.click();
    expect(await calls(page)).toEqual(["auto:false"]);
    await setState(page, state({ status: "idle", checkedAt: null, autoCheck: false }));
    await expect(auto).not.toBeChecked();
    await expect(page.getByTestId("setup-updates")).toContainText(
      "Nothing is downloaded until you press Download",
    );
  });

  test("a copy running from the source says updating is not available and offers nothing", async ({
    page,
  }) => {
    await installDesktop(page, state({ status: "unavailable" }));
    await page.goto("/");
    await openSettings(page, "setup");
    await expect(summary(page)).toHaveText("Not available here");
    await expect(page.getByTestId("update-detail")).toContainText("running from the source");
    await expect(page.getByTestId("update-check")).toHaveCount(0);
    await expect(page.getByTestId("update-auto")).toHaveCount(0);
    await expect(pill(page)).toHaveCount(0);
  });
});

test.describe("telling the app when the agent is working", () => {
  test("starts out not busy", async ({ page }) => {
    await installDesktop(page, IDLE);
    await page.goto("/");
    await expect(page.getByTestId("camera-toggle")).toBeVisible();
    await expect.poll(() => everyCall(page)).toContain("busy:false");
    expect((await everyCall(page)).includes("busy:true")).toBe(false);
  });
});
