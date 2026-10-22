import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import type { Bridge } from "../apps/bridge/src/server.ts";
import { fakeProvider } from "../apps/bridge/test/fake-provider.ts";
import { watchOutgoingData } from "./privacy.ts";
import { openSettings } from "./settings.ts";
import { openViewer, startTestBridge } from "./viewer.ts";

// Voice controls that need no speech: these run with Chromium's fake devices (a beeping fake microphone).
// Transcription and point-and-speak run against recorded speech in e2e/voice/.

let bridge: Bridge | null = null;
test.afterEach(async () => {
  await bridge?.stop();
  bridge = null;
});

/** Counts microphone requests (audio getUserMedia calls), so tests can tell whether the page asked for one. */
const countMicrophoneRequests = (page: Page) =>
  page.addInitScript(() => {
    const w = window as unknown as { __mic: number };
    w.__mic = 0;
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (constraints?.audio) w.__mic += 1;
      return original(constraints);
    };
  });

test("no microphone on load: nothing is requested and the indicator shows the microphone off", async ({
  page,
}) => {
  await countMicrophoneRequests(page);
  bridge = await startTestBridge(page);
  await openViewer(page);
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => (window as unknown as { __mic: number }).__mic)).toBe(0);
  await expect(page.getByTestId("mic-indicator")).toHaveAttribute("data-state", "off");
  await expect(page.getByTestId("mic-button")).toBeVisible(); // the main way to ask
  await openSettings(page, "voice");
  await expect(page.getByTestId("listen-for-names")).not.toBeChecked(); // listening for names is opt-in
});

test("listening from the palette: Ask agent starts the microphone and the indicator shows it", async ({
  page,
}) => {
  await countMicrophoneRequests(page);
  // Ask agent needs an agent (without one it says why), so this bridge runs the fake agent CLI.
  bridge = await startTestBridge(page, { agent: fakeProvider(mkdtempSync(join(tmpdir(), "hai-ask-"))) });
  await openViewer(page);
  await expect(page.getByTestId("agent-status")).toHaveAttribute("data-state", "idle");
  await page.keyboard.press("a"); // Ask agent
  await expect(page.getByTestId("mic-indicator")).toHaveAttribute("data-state", "on");
  // The indicator turns on as listening starts; the microphone request follows once the speech detector loads.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __mic: number }).__mic))
    .toBeGreaterThan(0);
  await expect(page.getByTestId("mic-button")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("mic-button").click(); // stop: nothing said yet, so nothing is sent
  await expect(page.getByTestId("mic-indicator")).toHaveAttribute("data-state", "off");
});

test("microphone denied: says how to re-enable it, and typing still works", async ({ page }) => {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (constraints?.audio) throw new DOMException("denied", "NotAllowedError");
      return original(constraints);
    };
  });
  bridge = await startTestBridge(page, { agent: fakeProvider(mkdtempSync(join(tmpdir(), "hai-denied-"))) });
  await openViewer(page);
  await page.getByTestId("mic-button").click();
  const error = page.getByTestId("voice-error");
  await expect(error).toHaveAttribute("data-error", "denied");
  await expect(error).toContainText("address bar");
  await expect(page.getByTestId("mic-indicator")).toHaveAttribute("data-state", "off");
  await expect(page.getByTestId("agent-input")).toBeEditable();
});

test("default is on-device: the speech setting reads On this laptop and says audio stays here", async ({
  page,
}) => {
  bridge = await startTestBridge(page);
  await openViewer(page);
  await openSettings(page, "voice");
  const mode = page.getByTestId("speech-mode");
  await expect(mode).toHaveValue("device");
  await expect(mode.locator("option:checked")).toHaveText("On this laptop");
  await expect(page.getByTestId("speech-mode-note")).toContainText("never leaves this laptop");
  await expect(mode.locator('option[value="cloud"]')).toContainText("sends audio to a third party");
});

test("the outgoing-data detector catches an injected audio upload (negative control)", async ({ page }) => {
  bridge = await startTestBridge(page);
  await openViewer(page);
  const violations = watchOutgoingData(page);
  // Test-only: post a tiny WAV, the way an audio privacy bug would.
  await page.evaluate(async () => {
    const wav = new Uint8Array([82, 73, 70, 70, 36, 0, 0, 0, 87, 65, 86, 69]); // "RIFF....WAVE"
    await fetch("/__privacy-probe", {
      method: "POST",
      headers: { "content-type": "audio/wav" },
      body: wav,
    }).catch(() => {});
  });
  await expect.poll(() => violations().length).toBeGreaterThan(0);
  expect(violations()[0]?.reason).toBe("content-type audio/wav");
});
