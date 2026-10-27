import { expect, test } from "@playwright/test";
import { startVoice } from "./tool-names.ts";

// The fake microphone plays test-assets/speech/sketch-area.wav once: "Sketch area."

test("a two-word tool name: saying sketch area picks Sketch area", async ({ page }) => {
  const { bridge, received } = await startVoice(page);
  try {
    await page.getByTestId("mic-button").click();
    await expect(page.getByTestId("active-tool")).toHaveAttribute("data-tool", "sketch-area", {
      timeout: 60_000,
    });
    expect(received()).toEqual([]);
  } finally {
    await bridge.stop();
  }
});
