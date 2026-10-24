// Runs against the real, signed-in Claude Code CLI, so it is manual: CI and a plain `pnpm test:e2e` skip it. Run it with
//   HAI_LIVE_CLAUDE=1 pnpm exec playwright test e2e/panel-live.spec.ts
// It sends one short request on the maintainer's own plan, in a throwaway project (the sample building), and saves
// what the agent wrote (the panel's document and screenshots) under test-results, for docs/decisions.md.
import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { ClaudeCliProvider } from "../packages/agent-core/src/index.ts";
import { offerCard, shell } from "./panel-support.ts";
import { openViewer, startTestBridge } from "./viewer.ts";

const live = process.env.HAI_LIVE_CLAUDE === "1";
test.skip(!live, "manual: needs the signed-in Claude Code CLI (HAI_LIVE_CLAUDE=1)");

test("the real agent offers a panel for a clearance with a tolerance, a nod opens it, and Done keeps the result", async ({
  page,
}, testInfo) => {
  test.setTimeout(420_000);
  const bridge = await startTestBridge(page, { agent: new ClaudeCliProvider() });
  try {
    await openViewer(page);
    await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
    await expect(page.getByTestId("agent-status")).toHaveAttribute("data-state", "idle", { timeout: 60_000 });

    const column = () => {
      const element = bridge.scene.scene.doc.elements["col-a1"];
      return element?.type === "column" ? element.position : null;
    };
    const before = column();

    await page
      .getByTestId("agent-input")
      .fill(
        "Architect, I want about 150 millimetres of clearance between the column col-a1 and the north wall, with a tolerance. Let me tune it.",
      );
    await page.getByTestId("agent-input").press("Enter");

    // The agent decides on its own to offer a panel (nothing told it to).
    await expect(offerCard(page)).toBeVisible({ timeout: 240_000 });
    await page.screenshot({ path: testInfo.outputPath("1-offer.png") });
    const purpose = await offerCard(page).getByTestId("offer-purpose").textContent();

    // A nod opens it.
    await page.evaluate(() =>
      window.__HAI_INPUT__?.gestures([{ type: "head.nod", ts: Date.now(), confidence: 1 }]),
    );
    await expect(shell(page)).toBeVisible({ timeout: 5_000 });
    await expect(shell(page)).toHaveAttribute("data-status", "ready", { timeout: 240_000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: testInfo.outputPath("2-panel.png") });
    const html = await page.getByTestId("panel-frame").getAttribute("srcdoc");
    writeFileSync(testInfo.outputPath("panel-document.html"), html ?? "");
    const title = await shell(page).getByTestId("panel-title").textContent();

    // Drag the first slider it drew; the model follows, in the viewer only.
    const frame = page.frameLocator('[data-testid="panel-frame"]');
    const ranges = frame.locator('input[type="range"]');
    const rangeCount = await ranges.count();
    console.log(`LIVE offer purpose: ${purpose}`);
    console.log(`LIVE panel title: ${title}; sliders: ${rangeCount}`);
    expect(rangeCount).toBeGreaterThan(0);
    const slider = ranges.first();
    const min = Number(await slider.getAttribute("min"));
    const max = Number(await slider.getAttribute("max"));
    await slider.fill(String(Math.round((min + (max - min) * 0.8) / 5) * 5));
    await page.waitForTimeout(800);
    await page.screenshot({ path: testInfo.outputPath("3-dragged.png") });
    const shown = await page.evaluate(() => {
      const doc = window.__HAI_SCENE__?.getSnapshot().doc ?? null;
      const column = window.__HAI_PANELS__?.shownDoc(doc)?.elements["col-a1"];
      return column?.position ?? null;
    });
    console.log(
      `LIVE column before ${JSON.stringify(before)}, committed ${JSON.stringify(column())}, shown ${JSON.stringify(shown)}`,
    );
    expect(column()).toEqual(before); // nothing is saved while previewing

    // Done keeps it as one undo step.
    await shell(page).getByTestId("panel-done").click();
    await expect(shell(page)).toHaveCount(0);
    await expect.poll(() => column(), { timeout: 10_000 }).not.toEqual(before);
    await page.screenshot({ path: testInfo.outputPath("4-done.png") });
    expect(await page.evaluate(() => window.__HAI_SCENE__?.getSnapshot().lastChange?.label)).toBe(title);

    // The agent is told, and says something.
    await expect
      .poll(
        async () =>
          (await page.getByTestId("task-transcript").count()) +
          (await page.getByTestId("agent-turn").count()),
        { timeout: 120_000 },
      )
      .toBeGreaterThan(0);
    await page.waitForTimeout(15_000);
    await page.screenshot({ path: testInfo.outputPath("5-after.png") });
  } finally {
    await bridge.stop();
  }
});
