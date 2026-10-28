import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import type { Bridge } from "../../apps/bridge/src/server.ts";
import { fakeProvider } from "../../apps/bridge/test/fake-provider.ts";
import { openViewer, startTestBridge } from "../viewer.ts";

let bridge: Bridge | null = null;
test.afterEach(async () => {
  await bridge?.stop();
  bridge = null;
});

/** A bridge with the fake Claude Code CLI, the viewer, and the team created by a first request. */
async function withTeam(page: Page, scheme: "light" | "dark") {
  await page.emulateMedia({ colorScheme: scheme });
  bridge = await startTestBridge(page, {
    agent: fakeProvider(mkdtempSync(join(tmpdir(), "hai-visual-team-"))),
  });
  await openViewer(page);
  await expect(page.getByTestId("agent-status")).toHaveAttribute("data-state", "idle");
  await page.getByTestId("agent-input").fill("hello");
  await page.getByTestId("agent-input").press("Enter");
  await expect(page.getByTestId("agent-turn").last()).toHaveAttribute("data-ended", "done");
}

for (const scheme of ["light", "dark"] as const) {
  test(`agents tab (${scheme})`, async ({ page }) => {
    await withTeam(page, scheme);
    await page.getByTestId("agent-tab-agents").click();
    await expect(page.getByTestId("agent-definition")).toHaveCount(7);
    await expect(page.getByTestId("agent-panel")).toHaveScreenshot(`agents-tab-${scheme}.png`);
  });
}

test("editing an agent", async ({ page }) => {
  await withTeam(page, "light");
  await page.getByTestId("agent-tab-agents").click();
  await page.getByRole("button", { name: "Edit Reviewer" }).click();
  await expect(page.getByTestId("agent-form")).toBeVisible();
  await expect(page.getByTestId("agent-panel")).toHaveScreenshot("agent-form-light.png");
});

for (const scheme of ["light", "dark"] as const) {
  test(`the collapsed rail waiting for you (${scheme})`, async ({ page }) => {
    await withTeam(page, scheme);
    await page.getByTestId("agent-input").fill("shell: echo hi");
    await page.getByTestId("agent-input").press("Enter");
    await expect(page.getByTestId("approval-card")).toHaveAttribute("data-outcome", "pending");
    await page.getByRole("button", { name: "Hide the agent panel" }).click();
    await expect(page.getByTestId("agent-strip")).toHaveAttribute("data-alert", "true");
    await expect(page.getByTestId("agent-strip")).toHaveScreenshot(`rail-strip-waiting-${scheme}.png`);
  });

  test(`a permission request opened in the model (${scheme})`, async ({ page }) => {
    await withTeam(page, scheme);
    await page.getByTestId("agent-input").fill("shell: echo hi");
    await page.getByTestId("agent-input").press("Enter");
    await page.getByTestId("approval-badge").click();
    await expect(page.getByTestId("approval-tag")).toBeVisible();
    await page.mouse.move(5, 5);
    // The badge pulses: the open one stands still, and the tag is what is compared.
    await expect(page.getByTestId("approval-tag")).toHaveScreenshot(`approval-tag-${scheme}.png`);
  });
}
