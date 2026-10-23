import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
  bridgeConnected,
  type Desktop,
  isAlive,
  launchDesktop,
  removeUserData,
  TEST_APP_VERSION,
} from "./desktop.ts";
import { openSettings } from "./settings.ts";

// Updating in the installed app. The app is built with a stand-in for electron-updater (apps/desktop/test/updates-deps-fake.ts)
// that plays a release feed from files in the fake Claude folder, so nothing goes over the network and no second version of
// the app is needed. The real updater's checks of the download (hash, signature) are electron-updater's own; what is tested
// here is everything HAI does around them.

let desktop: Desktop | null = null;
test.afterEach(async () => {
  await desktop?.close();
  if (desktop) removeUserData(desktop.userData);
  desktop = null;
});

const pill = (page: Page) => page.getByTestId("update-pill");
const summary = (page: Page) => page.getByTestId("update-summary");
const file = (d: Desktop, name: string) => join(d.fakeClaudeState, name);
const NEW = { "update-available": "1.1.0" };

async function openUpdates(page: Page) {
  await openSettings(page, "setup");
  await expect(page.getByTestId("setup-updates")).toBeVisible();
}

test.describe("finding an update", () => {
  test("is automatic on start: the top bar says so, and nothing is downloaded", async () => {
    desktop = await launchDesktop({ fakeFiles: NEW });
    await expect(pill(desktop.page)).toHaveText("Update 1.1.0 available", { timeout: 20_000 });
    await desktop.page.waitForTimeout(800);
    expect(existsSync(file(desktop, "download-started"))).toBe(false);
  });

  test("says you are up to date when there is nothing newer, after a check you ask for", async () => {
    desktop = await launchDesktop();
    await openUpdates(desktop.page);
    await expect(desktop.page.getByTestId("setup-updates")).toContainText(`Version ${TEST_APP_VERSION}`);
    await expect(summary(desktop.page)).toHaveText("You have the latest version", { timeout: 20_000 });
    await expect(pill(desktop.page)).toHaveCount(0);
  });

  test("a feed that cannot be reached is not an error on start, but a check you ask for says so", async () => {
    desktop = await launchDesktop({ fakeFiles: { "update-feed-down": "1" } });
    const { page } = desktop;
    await bridgeConnected(page);
    await page.waitForTimeout(1500); // the check on start has run
    await openUpdates(page);
    // It never got an answer, so it has not checked; what it must not do is show a failure nobody asked about.
    await expect(summary(page)).toHaveText("Not checked yet");
    await expect(summary(page)).not.toHaveAttribute("data-tone", "problem");
    await page.getByTestId("update-check").click();
    await expect(page.getByTestId("update-detail")).toContainText("Could not look for updates");
    await expect(summary(page)).toHaveAttribute("data-tone", "problem");
  });
});

test.describe("getting it", () => {
  test("downloads on request with progress, then restarts: the bridge and its agents end first", async () => {
    test.setTimeout(90_000);
    desktop = await launchDesktop({ fakeFiles: NEW });
    const { page } = desktop;
    await expect(pill(page)).toHaveText("Update 1.1.0 available", { timeout: 20_000 });
    await pill(page).click(); // opens Settings on the Setup page
    await expect(page.getByTestId("settings-page-setup")).toBeVisible();
    await expect(summary(page)).toHaveText("Version 1.1.0 is available");

    await page.getByTestId("update-download").click();
    await expect(summary(page)).toContainText("Downloading version 1.1.0", { timeout: 10_000 });
    expect(existsSync(file(desktop, "download-started"))).toBe(true);
    await expect(summary(page)).toHaveText("Version 1.1.0 is ready", { timeout: 20_000 });

    const bridgePid = desktop.bridgePid();
    expect(bridgePid).not.toBeNull();
    expect(isAlive(bridgePid as number)).toBe(true);
    await page.getByTestId("update-restart").click();
    await expect
      .poll(() => existsSync(file(desktop as Desktop, "restart-requested")), { timeout: 15_000 })
      .toBe(true);
    // Before the program is replaced, the bridge (and the agents under it) has ended.
    await expect.poll(() => isAlive(bridgePid as number), { timeout: 15_000 }).toBe(false);
  });

  test("a download that does not verify is refused: the user is told, and the installed version keeps working", async () => {
    test.setTimeout(60_000);
    desktop = await launchDesktop({ fakeFiles: { ...NEW, "update-fails": "sha512 checksum mismatch" } });
    const { page } = desktop;
    await expect(pill(page)).toHaveText("Update 1.1.0 available", { timeout: 20_000 });
    await openUpdates(page);
    await page.getByTestId("update-download").click();
    await expect(page.getByTestId("update-detail")).toContainText("sha512 checksum mismatch", {
      timeout: 20_000,
    });
    await expect(page.getByTestId("update-detail")).toContainText(
      `HAI ${TEST_APP_VERSION} is still installed and works as before`,
    );
    await expect(summary(page)).toHaveAttribute("data-tone", "problem");
    expect(existsSync(file(desktop, "restart-requested"))).toBe(false);
    await expect(page.getByTestId("update-restart")).toHaveCount(0); // nothing to restart into
    // And the app carries on.
    await bridgeConnected(page);
    await expect(page.getByTestId("camera-toggle")).toBeEnabled();
  });

  test("a restart waits while an agent turn is running, and is offered when it ends", async () => {
    test.setTimeout(120_000);
    desktop = await launchDesktop({ fakeFiles: NEW });
    const { page } = desktop;
    await expect(pill(page)).toHaveText("Update 1.1.0 available", { timeout: 20_000 });
    await openUpdates(page);
    await page.getByTestId("update-download").click();
    await expect(summary(page)).toHaveText("Version 1.1.0 is ready", { timeout: 20_000 });
    await expect(page.getByTestId("update-restart")).toBeEnabled();

    // The agent starts a turn that takes a few seconds (the fake Claude Code's "work N").
    await page.getByTestId("settings-close").click();
    await expect(page.getByTestId("agent-status")).toHaveAttribute("data-state", "idle", { timeout: 30_000 });
    await page.getByTestId("agent-input").fill("work 6000");
    await page.getByTestId("agent-input").press("Enter");
    await expect(page.getByTestId("agent-status")).toHaveAttribute("data-state", "working", {
      timeout: 15_000,
    });

    await openUpdates(page);
    const restart = page.getByTestId("update-restart");
    await expect(restart).toBeDisabled({ timeout: 10_000 });
    await expect(restart).toHaveText("Restart when the agent finishes");
    await expect(pill(page)).toHaveText("Update ready");
    expect(existsSync(file(desktop, "restart-requested"))).toBe(false);

    // The turn ends; the restart is offered.
    await expect(restart).toBeEnabled({ timeout: 30_000 });
    await expect(restart).toHaveText("Restart to update");
    await expect(pill(page)).toHaveText("Restart to update");
    await restart.click();
    await expect
      .poll(() => existsSync(file(desktop as Desktop, "restart-requested")), { timeout: 15_000 })
      .toBe(true);
  });
});

test.describe("the automatic-check switch", () => {
  test("is on by default, and when turned off is remembered: the next start does not look, a check you ask for still does", async () => {
    test.setTimeout(120_000);
    desktop = await launchDesktop();
    const userData = desktop.userData;
    await openUpdates(desktop.page);
    const auto = desktop.page.getByTestId("update-auto");
    await expect(auto).toBeChecked();
    await auto.click();
    await expect(auto).not.toBeChecked();
    await expect
      .poll(() =>
        existsSync(join(userData, "desktop.json"))
          ? readFileSync(join(userData, "desktop.json"), "utf8")
          : "",
      )
      .toContain('"autoCheckUpdates": false');
    await desktop.close();

    // A newer version exists, and the next start does not go looking for it.
    writeFileSync(join(userData, "fake-claude", "update-available"), "1.1.0");
    desktop = await launchDesktop({ userData });
    const { page } = desktop;
    await bridgeConnected(page);
    await page.waitForTimeout(2500);
    await expect(pill(page)).toHaveCount(0);
    await openUpdates(page);
    await expect(page.getByTestId("update-auto")).not.toBeChecked();
    await expect(summary(page)).toHaveText("Not checked yet");

    // A check the user asks for still runs.
    await page.getByTestId("update-check").click();
    await expect(summary(page)).toHaveText("Version 1.1.0 is available", { timeout: 20_000 });
  });

  test("turning it back on checks straight away", async () => {
    test.setTimeout(90_000);
    desktop = await launchDesktop();
    const { page } = desktop;
    await openUpdates(page);
    await expect(summary(page)).toHaveText("You have the latest version", { timeout: 20_000 }); // the check on start
    const auto = page.getByTestId("update-auto");
    await auto.click();
    await expect(auto).not.toBeChecked();

    // A newer version appears while automatic checks are off: nothing notices.
    writeFileSync(file(desktop, "update-available"), "1.1.0");
    await page.waitForTimeout(1500);
    await expect(pill(page)).toHaveCount(0);

    // Turning them on looks at once.
    await auto.click();
    await expect(auto).toBeChecked();
    await expect(pill(page)).toHaveText("Update 1.1.0 available", { timeout: 20_000 });
  });
});
