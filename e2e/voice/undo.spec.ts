import { expect, test } from "@playwright/test";
import { startVoice } from "./tool-names.ts";

// The fake microphone plays test-assets/speech/undo.wav once: "Undo."

test("Instant tool by voice: saying undo removes the last wall, keeps the tool and sends nothing", async ({
  page,
}) => {
  const { bridge, received } = await startVoice(page);
  try {
    await page.evaluate(() =>
      window.__HAI_SCENE__?.apply("Add Wall 1", [
        {
          op: "create",
          element: {
            id: "wall-voice",
            name: "Wall 1",
            type: "wall",
            properties: {},
            start: [0, 0],
            end: [4000, 0],
            height: 3000,
            thickness: 200,
          },
        },
      ]),
    );
    await expect.poll(() => bridge.scene.scene.doc.elements["wall-voice"]).toBeDefined();
    await page.keyboard.press("m");
    await page.getByTestId("mic-button").click();
    await expect
      .poll(() => bridge.scene.scene.doc.elements["wall-voice"], { timeout: 60_000 })
      .toBeUndefined();
    await expect(page.getByTestId("voice-picked")).toContainText("Undo picked");
    await expect(page.getByTestId("active-tool")).toHaveAttribute("data-tool", "move");
    expect(received()).toEqual([]);
  } finally {
    await bridge.stop();
  }
});
