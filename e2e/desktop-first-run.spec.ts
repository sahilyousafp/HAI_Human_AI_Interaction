import { spawnSync } from "node:child_process";
import { existsSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { bridgeConnected, type Desktop, isAlive, launchDesktop, removeUserData } from "./desktop.ts";
import { type ModelServer, startModelServer } from "./model-server.ts";

// First run in the installed app: the voice models are downloaded from a local server that serves the real files
// (e2e/model-server.ts), so the hashes are the real ones. Run with `pnpm test:e2e:desktop`.

let desktop: Desktop | null = null;
let models: ModelServer | null = null;
test.afterEach(async () => {
  await desktop?.close();
  if (desktop) removeUserData(desktop.userData);
  desktop = null;
  await models?.stop();
  models = null;
});

const screen = (page: Page) => page.getByTestId("first-run");
const action = (page: Page, id: string) => page.getByTestId(`first-run-action-${id}`);
const modelFile = (userData: string) => join(userData, "models", "kokoro", "onnx", "model.onnx");

test.describe("the voice models", () => {
  test("a fresh install offers the download, the app works meanwhile, and voice turns on by itself", async () => {
    test.setTimeout(300_000);
    models = await startModelServer({ rate: 60e6 }); // about 7 s for the 496 MB, long enough to watch
    desktop = await launchDesktop({ keepSetup: true });
    const { page } = desktop;

    // The screen offers it, with the size.
    await expect(screen(page)).toBeVisible();
    await expect(page.getByTestId("first-run-headline")).toHaveText("Download the voice models");
    await expect(page.getByTestId("first-run-detail")).toContainText("about 496 MB");
    await expect(page.getByTestId("mic-indicator")).toHaveAttribute("data-state", "missing");

    await action(page, "download").click();
    await expect(page.getByTestId("first-run-headline")).toHaveText("Downloading the voice models");
    await expect(page.getByTestId("first-run-progress")).toBeVisible();

    // The user goes on; the download carries on behind the app.
    await action(page, "continue").click();
    await expect(screen(page)).toHaveCount(0);
    await expect(page.getByTestId("camera-toggle")).toBeEnabled();
    const pill = page.getByTestId("mic-indicator");
    await expect(pill).toHaveAttribute("data-state", "preparing");
    await expect(pill).toContainText("Voice downloading");
    await expect(page.getByTestId("mic-button")).toBeDisabled();
    await expect(page.getByTestId("mic-button")).toHaveAttribute("data-voice", "preparing");
    expect(existsSync(modelFile(desktop.userData))).toBe(false); // not in place until it has been verified

    // It finishes: voice is available with no restart or reload.
    await expect(pill).toHaveAttribute("data-state", "off", { timeout: 120_000 });
    await expect(page.getByTestId("mic-button")).toBeEnabled();
    await expect(page.getByTestId("mic-button")).toHaveAttribute("data-voice", "ready");
    expect(existsSync(modelFile(desktop.userData))).toBe(true);
    // Each of the 14 files was fetched once, whole.
    expect(models.requests).toHaveLength(14);
    expect(models.requests.every((r) => r.range === null)).toBe(true);

    // The recogniser and the voice really load from the downloaded files (the same round trip as e2e/speech.spec.ts).
    const webgpu = await page.evaluate(async () => {
      const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
      return Boolean(gpu && (await gpu.requestAdapter()));
    });
    if (webgpu) {
      const heard = await page.evaluate(() =>
        (
          window as unknown as { __HAI_SPEECH__?: { roundTrip(text: string): Promise<string | null> } }
        ).__HAI_SPEECH__?.roundTrip("Architect is working on the stair core."),
      );
      expect((heard ?? "").toLowerCase()).toMatch(/architect is working on the stair ?cor/);
    }
  });
});

test.describe("offline and interrupted downloads", () => {
  test("with no connection the screen offers to try again or go on without voice, and the rest of the app works", async () => {
    test.setTimeout(180_000);
    // No model server is running: the host cannot be reached.
    desktop = await launchDesktop({ keepSetup: true });
    const { page } = desktop;
    await action(page, "download").click();
    await expect(page.getByTestId("first-run-headline")).toHaveText(
      "The voice models could not be downloaded",
    );
    await expect(page.getByTestId("first-run-detail")).toContainText("could not reach the internet");
    await expect(action(page, "retry")).toBeVisible();

    await action(page, "skip").click();
    await expect(screen(page)).toHaveCount(0);
    await bridgeConnected(page);
    await expect(page.getByTestId("camera-toggle")).toBeEnabled();
    await expect(page.getByTestId("mic-indicator")).toHaveText("Voice download failed");

    // The connection comes back: trying again from the Voice settings fetches the models, with no restart.
    models = await startModelServer();
    await page.getByTestId("settings-button").click();
    await page.getByTestId("settings-open-voice").click();
    await page.getByTestId("voice-models-download").click();
    await expect(page.getByTestId("mic-indicator")).toHaveAttribute("data-state", "off", {
      timeout: 120_000,
    });
    expect(existsSync(modelFile(desktop.userData))).toBe(true);
  });

  test("quitting in the middle of a file and starting again continues it, and refetches nothing that is done", async () => {
    test.setTimeout(240_000);
    models = await startModelServer({ rate: 25e6 });
    desktop = await launchDesktop({ keepSetup: true });
    const { page, userData } = desktop;
    await action(page, "download").click();

    // Wait until the large file is part way down, then end the app abruptly.
    const part = `${modelFile(userData)}.part`;
    await expect
      .poll(() => (existsSync(part) ? statSync(part).size : 0), { timeout: 120_000, intervals: [250] })
      .toBeGreaterThan(60e6);
    const bridgePid = desktop.bridgePid();
    // A crash or a power cut: the whole process tree ends at once, with no chance to tidy up.
    const mainPid = desktop.app.process().pid;
    if (mainPid) spawnSync("taskkill", ["/pid", String(mainPid), "/T", "/F"], { stdio: "ignore" });
    await expect
      .poll(() => (bridgePid === null ? false : isAlive(bridgePid)), { timeout: 15_000 })
      .toBe(false);
    const keptBytes = statSync(part).size;
    expect(keptBytes).toBeGreaterThan(60e6);
    expect(existsSync(modelFile(userData))).toBe(false);
    const requestsBefore = models.requests.length;
    models.rate = null; // the rest can come fast

    // Start again on the same data folder.
    desktop = await launchDesktop({ keepSetup: true, userData });
    const again = desktop.page;
    await expect(screen(again)).toBeVisible();
    await action(again, "download").click();
    await expect(again.getByTestId("mic-indicator")).toHaveAttribute("data-state", "off", {
      timeout: 120_000,
    });

    const requests = models.requests.slice(requestsBefore);
    // The small files that had finished are not fetched again.
    expect(requests.filter((r) => r.path.includes("moonshine-small"))).toEqual([]);
    // The large file continues from what was kept, not from the start.
    const large = requests.find((r) => r.path.endsWith("kokoro/onnx/model.onnx"));
    expect(large?.range).not.toBeNull();
    const start = Number(/bytes=(\d+)-/.exec(large?.range ?? "")?.[1]);
    expect(start).toBeGreaterThanOrEqual(keptBytes);
    expect(existsSync(modelFile(userData))).toBe(true);
    expect(existsSync(`${modelFile(userData)}.part`)).toBe(false);
  });
});

test.describe("tracking needs nothing downloaded", () => {
  test("with no voice models and every outside request blocked, the viewer shows and hands are tracked", async () => {
    test.setTimeout(180_000);
    desktop = await launchDesktop({ keepSetup: true, clip: "one-hand-pinch" });
    const { page } = desktop;
    // Block every request that leaves this computer, and count the attempts.
    await desktop.app.evaluate(({ session }) => {
      const attempts: string[] = [];
      (globalThis as { __blocked?: string[] }).__blocked = attempts;
      session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
        const outside =
          /^(https?|wss?|ftp):\/\//.test(details.url) &&
          !/^(https?|wss?):\/\/127\.0\.0\.1[:/]/.test(details.url);
        if (outside) attempts.push(details.url);
        callback({ cancel: outside });
      });
    });

    // The voice models are missing; the user goes on without them.
    await action(page, "skip").click();
    await bridgeConnected(page);
    await expect(page.getByTestId("mic-indicator")).toHaveAttribute("data-state", "missing");

    await page.getByTestId("camera-toggle").click();
    await expect(page.getByTestId("camera-indicator")).toHaveAttribute("data-state", "on");
    const trackingFrames = () =>
      page.evaluate(
        () =>
          (window as unknown as { __HAI_TRACKING__?: { frames: { hands: string[] }[] } }).__HAI_TRACKING__
            ?.frames ?? [],
      );
    await expect
      .poll(async () => (await trackingFrames()).filter((f) => f.hands.length > 0).length, {
        timeout: 90_000,
      })
      .toBeGreaterThan(10);
    const withHand = (await trackingFrames()).filter((f) => f.hands.length > 0);
    expect(withHand.every((f) => f.hands.length === 1 && f.hands[0] === "Right")).toBe(true);

    // The viewer drew its scene: a canvas with a size.
    const canvas = await page.locator("canvas").first().boundingBox();
    expect(canvas?.width).toBeGreaterThan(200);

    // Nothing tried to leave the computer.
    expect(
      await desktop.app.evaluate(() => (globalThis as { __blocked?: string[] }).__blocked ?? []),
    ).toEqual([]);
  });
});

// Claude Code's side of the first run: the app is built with a stand-in for the installer and the sign-in window
// (apps/desktop/test/claude-deps-fake.ts) that leaves files in the fake Claude folder, so nothing is installed or signed in.
const fakeFile = (d: Desktop, name: string) => join(d.fakeClaudeState, name);
const headline = (page: Page) => page.getByTestId("first-run-headline");
const START_MISSING = { HAI_FAKE_CLAUDE_START: "missing" };

test.describe("Claude Code, from nothing to the agent", () => {
  test("a clean machine: install, sign in, skip the voice, and the agent answers", async () => {
    test.setTimeout(180_000);
    desktop = await launchDesktop({ keepSetup: true, env: START_MISSING });
    const { page } = desktop;

    // Step 1 asks first and runs nothing.
    await expect(headline(page)).toHaveText("Install Claude Code");
    await expect(page.locator(".first-run-kicker")).toHaveText("Setting up HAI \u00b7 Step 1 of 2");
    await expect(page.getByTestId("first-run-command")).toHaveText("irm https://claude.ai/install.ps1 | iex");
    await page.waitForTimeout(1500);
    expect(existsSync(fakeFile(desktop, "installer-ran"))).toBe(false);

    // Install shows the installer's own lines, then moves on to the sign-in.
    await action(page, "install").click();
    await expect(headline(page)).toHaveText("Installing Claude Code");
    await expect(page.getByTestId("first-run-output")).toContainText("Downloading Claude Code...");
    await expect(headline(page)).toHaveText("Sign in to Claude", { timeout: 30_000 });
    expect(existsSync(fakeFile(desktop, "installed"))).toBe(true);

    // Sign-in happens in Claude Code's own window; the screen waits and moves on by itself.
    await action(page, "signin").click();
    await expect(headline(page)).toHaveText("Waiting for you to sign in");
    expect(existsSync(fakeFile(desktop, "signin-opened"))).toBe(true);
    writeFileSync(fakeFile(desktop, "signed-in"), "1"); // the user finished signing in, in the other window
    await expect(headline(page)).toHaveText("Claude Code is ready", { timeout: 30_000 });
    await expect(page.getByTestId("first-run-detail")).toContainText("Version 2.1.303");
    await action(page, "continue").click();

    // Step 2: voice. Skip it; the app is usable without.
    await expect(page.locator(".first-run-kicker")).toHaveText("Setting up HAI \u00b7 Step 2 of 2");
    await action(page, "skip").click();
    await expect(screen(page)).toHaveCount(0);

    // The agent answers (the bridge runs the fake Claude Code CLI).
    await bridgeConnected(page);
    await expect(page.getByTestId("agent-status")).toHaveAttribute("data-state", "idle", { timeout: 30_000 });
    await page.getByTestId("agent-input").fill("hello");
    await page.getByTestId("agent-input").press("Enter");
    await expect(page.getByTestId("agent-turn").last()).toContainText("agent=mochi", { timeout: 30_000 });
  });

  test("a failed install says what happened and keeps the installer's output, and Try again finishes it", async () => {
    test.setTimeout(120_000);
    desktop = await launchDesktop({
      keepSetup: true,
      env: { ...START_MISSING, HAI_FAKE_INSTALL_FAILS: "1" },
    });
    const { page } = desktop;
    await action(page, "install").click();
    await expect(headline(page)).toHaveText("The installation did not finish", { timeout: 30_000 });
    await expect(page.getByTestId("first-run-detail")).toContainText("exit code 2");
    await expect(page.getByTestId("first-run-output")).toContainText("Access to the path is denied");
    await expect(page.getByTestId("first-run-manual")).toHaveAttribute(
      "href",
      "https://code.claude.com/docs/en/setup",
    );
    await expect(page.getByTestId("camera-toggle")).toBeVisible(); // the rest of the app is untouched

    await action(page, "install").click();
    await expect(headline(page)).toHaveText("Sign in to Claude", { timeout: 30_000 });
  });

  test("already installed but not signed in: goes straight to the sign-in", async () => {
    desktop = await launchDesktop({ keepSetup: true, env: { HAI_FAKE_CLAUDE_START: "signed-out" } });
    const { page } = desktop;
    await expect(headline(page)).toHaveText("Sign in to Claude");
    await expect(page.getByTestId("first-run-command-block")).toHaveCount(0);
    expect(existsSync(fakeFile(desktop, "installer-ran"))).toBe(false);
  });

  test("installed by hand while the screen is open: 'I installed it myself' looks again and moves on", async () => {
    desktop = await launchDesktop({ keepSetup: true, env: START_MISSING });
    const { page } = desktop;
    await expect(headline(page)).toHaveText("Install Claude Code");
    writeFileSync(fakeFile(desktop, "installed"), "1");
    writeFileSync(fakeFile(desktop, "signed-in"), "1");
    await action(page, "recheck").click();
    await expect(headline(page)).toHaveText("Claude Code is ready");
  });

  test("skipping is remembered across a restart, and Settings > Setup brings the screens back", async () => {
    test.setTimeout(120_000);
    desktop = await launchDesktop({ keepSetup: true, env: START_MISSING });
    let { page } = desktop;
    await action(page, "skip").click(); // Claude Code
    await action(page, "skip").click(); // voice
    await expect(screen(page)).toHaveCount(0);
    const userData = desktop.userData;
    await desktop.close();

    desktop = await launchDesktop({ keepSetup: true, userData, env: START_MISSING });
    page = desktop.page;
    await bridgeConnected(page);
    await page.waitForTimeout(1500);
    await expect(screen(page)).toHaveCount(0); // not at every launch

    await page.getByTestId("settings-button").click();
    await page.getByTestId("settings-open-setup").click();
    await expect(page.getByTestId("setup-claude-status")).toHaveText("Not installed");
    await expect(page.getByTestId("setup-voice-status")).toHaveText("Not downloaded");
    await page.getByTestId("setup-open").click();
    await expect(headline(page)).toHaveText("Install Claude Code");
  });
});
