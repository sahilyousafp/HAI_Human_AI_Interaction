import { expect, test } from "@playwright/test";
import { startVoice } from "./tool-names.ts";

// The fake microphone plays test-assets/speech/measure-the-towers.wav once:
// "Measure the distance between these towers."

test("A longer request goes to the agent: a sentence that starts with a tool name is a request, not a tool", async ({
  page,
}) => {
  const { bridge, received } = await startVoice(page);
  try {
    await page.getByTestId("mic-button").click();
    await expect(page.getByTestId("voice-transcript")).toBeVisible({ timeout: 60_000 });
    await page.evaluate(() =>
      window.__HAI_INPUT__?.gestures([{ type: "head.nod", ts: Date.now(), confidence: 1 }]),
    );
    await expect
      .poll(() => received().some((t) => /measure the distance between these towers/i.test(t)))
      .toBe(true);
    await expect(page.getByTestId("active-tool")).toHaveAttribute("data-tool", "select");
  } finally {
    await bridge.stop();
  }
});
