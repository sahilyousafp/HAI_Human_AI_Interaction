import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { fakeProvider } from "../../apps/bridge/test/fake-provider.ts";
import { holdAt, releaseAt } from "../hands.ts";
import { watchOutgoingData } from "../privacy.ts";
import { closeSettings, openSettings } from "../settings.ts";
import { findElementOnScreen, handAt, openViewer, startTestBridge } from "../viewer.ts";

// The fake microphone plays test-assets/speech/make-this-wall-300-thick.wav once from when the microphone opens:
// a second of silence, "Make this wall three hundred thick." (about two seconds), then three seconds of silence.

/** A private bridge with the fake agent CLI, the viewer, and what the fake agent received. */
async function start(page: Page) {
  const state = mkdtempSync(join(tmpdir(), "hai-voice-"));
  const bridge = await startTestBridge(page, { agent: fakeProvider(state) });
  await openViewer(page);
  await expect(page.getByTestId("agent-status")).toHaveAttribute("data-state", "idle");
  /** Every request text the fake agent received, in order. */
  const received = () =>
    readdirSync(state)
      .filter((f) => !f.startsWith("start-") && f.endsWith(".json"))
      .flatMap((f) => JSON.parse(readFileSync(join(state, f), "utf8")) as string[]);
  return { bridge, received };
}

const transcript = (page: Page) => page.getByTestId("voice-transcript");
const inject = (page: Page, type: string) =>
  page.evaluate((t) => window.__HAI_INPUT__?.gestures([{ type: t, ts: Date.now(), confidence: 1 }]), type);

test("transcript of a known sample: heard, transcribed on this laptop, and the microphone stops on silence", async ({
  page,
}) => {
  const { bridge } = await start(page);
  try {
    const outgoing = watchOutgoingData(page);
    await page.getByTestId("mic-button").click();
    await expect(page.getByTestId("mic-indicator")).toHaveAttribute("data-state", "on");
    await expect(transcript(page)).toBeVisible({ timeout: 60_000 });
    const text = (await transcript(page).inputValue()).toLowerCase();
    for (const word of ["make", "wall", "thick"]) expect(text).toContain(word);
    await expect(page.getByTestId("mic-indicator")).toHaveAttribute("data-state", "off");
    // No audio on the network: nothing the page sent (HTTP or bridge messages) carried audio data.
    expect(outgoing()).toEqual([]);
    await openSettings(page, "voice");
    await expect(page.getByTestId("speech-backend")).toHaveText("WASM");
  } finally {
    await bridge.stop();
  }
});

test("nod sends immediately: the request reaches the agent without waiting for the countdown", async ({
  page,
}) => {
  const { bridge, received } = await start(page);
  try {
    await page.getByTestId("mic-button").click();
    await expect(transcript(page)).toBeVisible({ timeout: 60_000 });
    await inject(page, "head.nod");
    await expect(page.getByTestId("voice-bar")).toHaveCount(0);
    await expect(page.getByTestId("agent-turn").last().locator(".agent-request")).toContainText(/wall/i);
    await expect.poll(() => received().at(-1) ?? "").toMatch(/^\[context\] references: none; .*\n.*wall/is);
  } finally {
    await bridge.stop();
  }
});

test("shake discards: nothing is sent and the transcript is marked discarded", async ({ page }) => {
  const { bridge, received } = await start(page);
  try {
    await page.getByTestId("mic-button").click();
    await expect(transcript(page)).toBeVisible({ timeout: 60_000 });
    await inject(page, "head.shake");
    await expect(page.getByTestId("voice-discarded")).toContainText(/wall/i);
    await page.waitForTimeout(2000); // well past the send countdown
    expect(received()).toEqual([]);
    await expect(page.getByTestId("agent-turn")).toHaveCount(0);
  } finally {
    await bridge.stop();
  }
});

test('"make this 300 thick" while pointing: the wall gets marker 1 and is the first reference the agent receives', async ({
  page,
}) => {
  const { bridge, received } = await start(page);
  try {
    // Pointing numbers elements only when asked for (it is off by default).
    await openSettings(page, "features");
    await page.getByTestId("feature-pointCapture").click();
    await closeSettings(page);
    const wall = await findElementOnScreen(page, "wall-s");
    await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
    await page.getByTestId("mic-button").click();
    // Point at the wall while speaking (the phrase starts a second after the microphone opens).
    await expect(page.getByTestId("voice-bar")).toContainText("Listening", { timeout: 30_000 });
    await page.evaluate((p) => window.__HAI_INPUT__?.pointer(p), await handAt(page, wall));
    const marker = page.getByTestId("reference-marker");
    await expect(marker).toHaveText("1");
    await expect(marker).toHaveAttribute("data-element", "wall-s");
    await expect(transcript(page)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("voice-refs")).toContainText("1");
    await page.keyboard.press("Enter");
    await expect.poll(() => received().at(-1) ?? "").toMatch(/^\[context\] references: 1\) wall wall-s "/);
    await expect(marker).toHaveCount(0); // markers clear once the request is sent
  } finally {
    await bridge.stop();
  }
});

test("Held request is sent on release, and Shake stops a sent request: the stop goes to the bridge for that request", async ({
  page,
}) => {
  const { bridge, received } = await start(page);
  try {
    const stops: string[] = [];
    page.on("websocket", (ws) =>
      ws.on("framesent", (frame) => {
        if (typeof frame.payload === "string" && frame.payload.includes('"agent.stopRequest"'))
          stops.push(frame.payload);
      }),
    );
    await page.reload();
    await openViewer(page);
    await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
    const at = await findElementOnScreen(page, "block-c");
    await holdAt(page, at);
    await expect(page.getByTestId("held-chip")).toContainText("Point at what you mean", { timeout: 60_000 });
    await page.waitForTimeout(3000); // the rest of the sentence and the pause after it
    await releaseAt(page, at);
    await expect(page.getByTestId("held-chip")).toContainText("Sent - shake to stop", { timeout: 30_000 });
    await expect(page.getByTestId("voice-transcript")).toHaveCount(0); // no countdown
    await expect
      .poll(() => received().find((t) => /thick/i.test(t)) ?? "")
      .toMatch(/target \("this"\): massing block-c/);
    await inject(page, "head.shake");
    await expect(page.getByTestId("held-chip")).toHaveText("Stopped");
    await expect.poll(() => stops.length).toBe(1);
  } finally {
    await bridge.stop();
  }
});
