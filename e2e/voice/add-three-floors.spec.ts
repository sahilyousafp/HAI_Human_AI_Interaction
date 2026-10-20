import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { fakeProvider } from "../../apps/bridge/test/fake-provider.ts";
import { watchOutgoingData } from "../privacy.ts";
import { openViewer, startTestBridge } from "../viewer.ts";

// The fake microphone plays test-assets/speech/add-three-floors.wav once from when the microphone opens: "Add three
// floors." No team name, so while listening for names it must come to nothing.

test("listening for names: speech without a name is ignored, shown nowhere and sent nowhere", async ({
  page,
}) => {
  const state = mkdtempSync(join(tmpdir(), "aex-voice-"));
  const bridge = await startTestBridge(page, { agent: fakeProvider(state) });
  try {
    await openViewer(page);
    await expect(page.getByTestId("agent-status")).toHaveAttribute("data-state", "idle");
    const outgoing = watchOutgoingData(page);
    await page.getByTestId("listen-for-names").check();
    // The utterance was heard and transcribed here (the latency statistic appears), then dropped.
    await expect(page.getByTestId("speech-latency")).not.toHaveText("-", { timeout: 60_000 });
    await page.waitForTimeout(2500); // well past any send countdown
    await expect(page.getByTestId("voice-transcript")).toHaveCount(0);
    await expect(page.getByTestId("voice-bar")).toHaveCount(0);
    await expect(page.getByTestId("agent-turn")).toHaveCount(0);
    expect(readdirSync(state).filter((f) => f.startsWith("start-"))).toEqual([]); // the agent never started
    await expect(page.getByTestId("mic-indicator")).toHaveAttribute("data-state", "names");
    expect(outgoing()).toEqual([]);
    // Turning it off releases the microphone.
    await page.getByTestId("listen-for-names").uncheck();
    await expect(page.getByTestId("mic-indicator")).toHaveAttribute("data-state", "off");
  } finally {
    await bridge.stop();
  }
});
