// Shared by the live specs that drive the real, signed-in Claude Code CLI (HAI_LIVE_CLAUDE=1).
import { expect, type Page } from "@playwright/test";
import type { Team } from "../apps/bridge/src/agent/team.ts";
import { ClaudeCliProvider } from "../packages/agent-core/src/index.ts";
import { openViewer, startTestBridge } from "./viewer.ts";

export const ENDED = ["done", "failed", "stopped"];

export async function start(page: Page) {
  const bridge = await startTestBridge(page, { agent: new ClaudeCliProvider() });
  await openViewer(page);
  await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
  await expect(page.getByTestId("agent-status")).toHaveAttribute("data-state", "idle", { timeout: 60_000 });
  return { bridge, team: bridge.agent as Team };
}

export const ask = async (page: Page, text: string) => {
  await page.getByTestId("agent-input").fill(text);
  await page.getByTestId("agent-input").press("Enter");
};

/** Waits for `done`, allowing any tool the agent asks permission for. */
export async function until(
  page: Page,
  done: () => boolean | Promise<boolean>,
  ms: number,
  each?: () => Promise<void>,
) {
  const allow = page.getByRole("button", { name: "Allow", exact: true });
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (await done()) return true;
    if (await allow.first().isVisible()) await allow.first().click();
    await each?.();
    await page.waitForTimeout(1_000);
  }
  return false;
}
