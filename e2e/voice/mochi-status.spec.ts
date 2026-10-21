import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { fakeProvider } from "../../apps/bridge/test/fake-provider.ts";
import { watchOutgoingData } from "../privacy.ts";
import { openSettings } from "../settings.ts";
import { openViewer, startTestBridge } from "../viewer.ts";

// The fake microphone plays test-assets/speech/mochi-status.wav once from when the microphone opens: "Mochi, what
// is everyone doing?"

test("listening for names: a named utterance becomes a request with its countdown, addressed to Mochi", async ({
  page,
}) => {
  const bridge = await startTestBridge(page, {
    agent: fakeProvider(mkdtempSync(join(tmpdir(), "aex-voice-"))),
  });
  try {
    await openViewer(page);
    await expect(page.getByTestId("agent-status")).toHaveAttribute("data-state", "idle");
    const outgoing = watchOutgoingData(page);
    await openSettings(page, "voice");
    await page.getByTestId("listen-for-names").check();
    const indicator = page.getByTestId("mic-indicator");
    await expect(indicator).toHaveAttribute("data-state", "names");
    await expect(indicator).toHaveText("Listening for names");
    const transcript = page.getByTestId("voice-transcript");
    await expect(transcript).toBeVisible({ timeout: 60_000 });
    expect((await transcript.inputValue()).toLowerCase()).toMatch(/^m\w+\W+what is everyone doing/);
    await expect(page.getByTestId("voice-countdown")).toBeVisible();
    // Sent when the countdown ends, to Mochi (no specialist named), without the name.
    const request = page.getByTestId("agent-turn").first().locator(".agent-request");
    await expect(request).toHaveText(/^what is everyone doing/i);
    // The microphone keeps listening for the next name, and no audio left the page.
    await expect(indicator).toHaveAttribute("data-state", "names");
    expect(outgoing()).toEqual([]);
  } finally {
    await bridge.stop();
  }
});
