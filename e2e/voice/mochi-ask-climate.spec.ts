import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { fakeProvider } from "../../apps/bridge/test/fake-provider.ts";
import { openViewer, startTestBridge } from "../viewer.ts";

// The fake microphone plays test-assets/speech/mochi-ask-climate.wav once: "Mochi, ask Climate to run a winter
// shadow study." The recogniser hears "Mochi" as "Machi" (docs/decisions.md); the alias still finds Mochi.

test("Mochi asked to delegate by voice: Mochi gets the request and hands the study to Climate", async ({
  page,
}) => {
  const bridge = await startTestBridge(page, {
    agent: fakeProvider(mkdtempSync(join(tmpdir(), "aex-voice-"))),
  });
  try {
    await openViewer(page);
    await expect(page.getByTestId("agent-status")).toHaveAttribute("data-state", "idle");
    await page.getByTestId("mic-button").click();
    const transcript = page.getByTestId("voice-transcript");
    await expect(transcript).toBeVisible({ timeout: 60_000 });
    await page.keyboard.press("Enter");
    const request = page.getByTestId("agent-turn").first().locator(".agent-request");
    await expect(request).toHaveText(/^ask(ed)? climate to run a winter shadow study/i); // without "Mochi"
    const handOff = page.getByTestId("handoff-chip");
    await expect(handOff).toContainText("Climate");
    await expect(handOff).toContainText(/winter shadow study/i);
  } finally {
    await bridge.stop();
  }
});
