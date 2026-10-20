import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { fakeProvider } from "../../apps/bridge/test/fake-provider.ts";
import { openViewer, startTestBridge } from "../viewer.ts";

// The fake microphone plays test-assets/speech/hey-mochi-status.wav once from when the microphone opens: "Hey
// Mochi, what is everyone doing?"

test("listening for names: 'Hey Mochi' counts as the name, and the greeting is taken out with it", async ({
  page,
}) => {
  const bridge = await startTestBridge(page, {
    agent: fakeProvider(mkdtempSync(join(tmpdir(), "aex-voice-"))),
  });
  try {
    await openViewer(page);
    await expect(page.getByTestId("agent-status")).toHaveAttribute("data-state", "idle");
    await page.getByTestId("listen-for-names").check();
    await expect(page.getByTestId("mic-indicator")).toHaveAttribute("data-state", "names");
    const transcript = page.getByTestId("voice-transcript");
    await expect(transcript).toBeVisible({ timeout: 60_000 });
    expect((await transcript.inputValue()).toLowerCase()).toMatch(/what is everyone doing/);
    const request = page.getByTestId("agent-turn").first().locator(".agent-request");
    await expect(request).toHaveText(/^what is everyone doing/i);
  } finally {
    await bridge.stop();
  }
});
