import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { fakeProvider } from "../../apps/bridge/test/fake-provider.ts";
import { openViewer, startTestBridge } from "../viewer.ts";

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
