import { expect, test } from "@playwright/test";
import { listenAndTime, startVoice, toolTiming } from "./tool-names.ts";

// The fake microphone plays test-assets/speech/measure.wav once: "Measure."

test("Say a tool name: Measure is picked within 300 ms of the utterance ending, and no request reaches the agent", async ({
  page,
}) => {
  const { bridge, received } = await startVoice(page);
  try {
    // Engaged, as a user who speaks to the app is: the speech model loads now, not when the word is said.
    await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
    await page.waitForTimeout(4000);
    await listenAndTime(page);
    await expect(page.getByTestId("active-tool")).toHaveAttribute("data-tool", "measure", {
      timeout: 60_000,
    });
    await expect(page.getByTestId("voice-picked")).toContainText("Measure picked");
    await expect(page.getByTestId("voice-transcript")).toHaveCount(0);
    await expect(page.getByTestId("mic-indicator")).toHaveAttribute("data-state", "off");
    const ms = await toolTiming(page);
    console.log(`measure: end of speech to tool ${ms} ms`);
    expect(ms).not.toBeNull();
    // The budget is for the reference laptop; CPU-only CI runners transcribe more slowly.
    if (!process.env.CI) expect(ms).toBeLessThanOrEqual(300);
    await page.waitForTimeout(1500);
    expect(received()).toEqual([]);
    await expect(page.getByTestId("agent-turn")).toHaveCount(0);
  } finally {
    await bridge.stop();
  }
});
