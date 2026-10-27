import { expect, test } from "@playwright/test";
import { startVoice } from "./tool-names.ts";

// The fake microphone plays test-assets/speech/bake.wav once: "Bake to Rhino."

test("Registered tool can be spoken: a tool registered at runtime is picked by saying its spoken name", async ({
  page,
}) => {
  const { bridge, received } = await startVoice(page);
  try {
    await page.evaluate(() =>
      window.__HAI_TOOLS__?.registry.register({
        id: "test-bake",
        label: "Bake to Rhino",
        icon: "M4 4h16v16H4z",
        shortcut: "j",
        spoken: ["bake", "bake to rhino"],
      }),
    );
    await page.getByTestId("mic-button").click();
    await expect(page.getByTestId("active-tool")).toHaveAttribute("data-tool", "test-bake", {
      timeout: 60_000,
    });
    expect(received()).toEqual([]);
  } finally {
    await bridge.stop();
  }
});
