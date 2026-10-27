import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { fakeProvider } from "../../apps/bridge/test/fake-provider.ts";
import { holdAt, releaseAt } from "../hands.ts";
import { findElementOnScreen, openViewer, startTestBridge } from "../viewer.ts";
import { startVoice } from "./tool-names.ts";

// The fake microphone plays test-assets/speech/architect-stair-core.wav once: "Architect, add a stair core here."

test("spoken specialist name: Mochi receives the request without the name and hands it to Architect", async ({
  page,
}) => {
  const bridge = await startTestBridge(page, {
    agent: fakeProvider(mkdtempSync(join(tmpdir(), "hai-voice-"))),
  });
  try {
    await openViewer(page);
    await expect(page.getByTestId("agent-status")).toHaveAttribute("data-state", "idle");
    await page.getByTestId("mic-button").click();
    const transcript = page.getByTestId("voice-transcript");
    await expect(transcript).toBeVisible({ timeout: 60_000 });
    // Heard as "Architect, at a stair core here." on the reference laptop: the name is what matters here.
    expect((await transcript.inputValue()).toLowerCase()).toMatch(/^architect\W+.*stair ?core/);
    await page.keyboard.press("Enter");
    const request = page.getByTestId("agent-turn").first().locator(".agent-request");
    await expect(request).toHaveText(/stair ?core/i);
    await expect(request).not.toHaveText(/architect/i); // the name is not part of the request
    const handOff = page.getByTestId("handoff-chip");
    await expect(handOff).toContainText("Architect");
    await expect(handOff).toHaveAttribute("data-status", "done");
  } finally {
    await bridge.stop();
  }
});

test("Addressing still works: a held pinch on a column, then the specialist's name, goes to Architect with the column as this", async ({
  page,
}) => {
  const { bridge, received } = await startVoice(page);
  try {
    await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
    const at = await findElementOnScreen(page, "col-a1");
    await holdAt(page, at);
    await expect(page.getByTestId("held-chip")).toContainText("Point at what you mean", { timeout: 60_000 });
    await page.waitForTimeout(3500); // the rest of the sentence and the pause after it
    await releaseAt(page, at);
    // Sent at once, without the review countdown.
    await expect(page.getByTestId("held-chip")).toContainText("Sent - shake to stop", { timeout: 30_000 });
    await expect(page.getByTestId("voice-transcript")).toHaveCount(0);
    const request = page.getByTestId("agent-turn").first().locator(".agent-request");
    await expect(request).toHaveText(/stair ?core/i);
    await expect(request).not.toHaveText(/architect/i);
    await expect(page.getByTestId("handoff-chip")).toContainText("Architect");
    // Mochi was told the column is "this".
    await expect
      .poll(() => received().find((t) => /stair ?core/i.test(t)) ?? "")
      .toContain('target ("this"): column col-a1');
  } finally {
    await bridge.stop();
  }
});
