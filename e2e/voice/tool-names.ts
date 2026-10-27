// Shared by the voice specs for tool names: the fake microphone plays one phrase that is (or is not) a tool's name.
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { fakeProvider } from "../../apps/bridge/test/fake-provider.ts";
import { openViewer, startTestBridge } from "../viewer.ts";

/** A private bridge with the fake agent CLI and the viewer; `received` lists every request the fake agent got. */
export async function startVoice(page: Page) {
  const state = mkdtempSync(join(tmpdir(), "hai-voice-tools-"));
  const bridge = await startTestBridge(page, { agent: fakeProvider(state) });
  await openViewer(page);
  await expect(page.getByTestId("agent-status")).toHaveAttribute("data-state", "idle");
  const received = () =>
    readdirSync(state)
      .filter((f) => !f.startsWith("start-") && f.endsWith(".json"))
      .flatMap((f) => {
        const data = JSON.parse(readFileSync(join(state, f), "utf8"));
        return Array.isArray(data) ? (data as string[]) : [];
      });
  return { bridge, received };
}

/**
 * Starts listening and records, in the page, when the utterance ended (the transcript is being written) and when the
 * active tool changed, so the time from the end of speech to the tool can be read.
 */
export async function listenAndTime(page: Page): Promise<void> {
  await page.evaluate(() => {
    const marks: { ended?: number; tool?: number } = {};
    (window as unknown as { __TOOL_TIMING__: typeof marks }).__TOOL_TIMING__ = marks;
    const tool = document.querySelector("[data-testid=active-tool]");
    const initial = tool?.getAttribute("data-tool");
    new MutationObserver(() => {
      if (
        marks.ended === undefined &&
        document.querySelector("[data-testid=voice-bar][data-phase=transcribing]")
      )
        marks.ended = performance.now();
      const now = document.querySelector("[data-testid=active-tool]")?.getAttribute("data-tool");
      if (marks.tool === undefined && now !== initial) marks.tool = performance.now();
    }).observe(document.body, { subtree: true, childList: true, attributes: true });
  });
  await page.getByTestId("mic-button").click();
}

/** Milliseconds from the end of speech to the tool being picked, once both happened. */
export const toolTiming = (page: Page) =>
  page.evaluate(() => {
    const marks = (window as unknown as { __TOOL_TIMING__: { ended?: number; tool?: number } })
      .__TOOL_TIMING__;
    return marks.ended !== undefined && marks.tool !== undefined
      ? Math.round(marks.tool - marks.ended)
      : null;
  });
