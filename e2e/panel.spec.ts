import { expect, test } from "@playwright/test";
import {
  askForPanel,
  box,
  frame,
  gesture,
  offerCard,
  openClearancePanel,
  sceneOf,
  shell,
  start,
  stopBridge,
  team,
} from "./panel-support.ts";
import { closeSettings, openSettings } from "./settings.ts";

// Generated panels: the agent offers a panel, a nod opens it, and the panel floats over the model.

test.afterEach(stopBridge);

test.describe("the offer", () => {
  test("Offer is shown: a card with the purpose, Open and Skip; no panel is open", async ({ page }) => {
    await start(page);
    await askForPanel();
    await expect(offerCard(page)).toBeVisible();
    await expect(offerCard(page).getByTestId("offer-purpose")).toHaveText("Set the wall to column clearance");
    await expect(offerCard(page).getByTestId("offer-open")).toBeVisible();
    await expect(offerCard(page).getByTestId("offer-skip")).toBeVisible();
    await expect(shell(page)).toHaveCount(0);
  });

  test("Skip: the card shows Skipped, no panel opens, and the agent carries on", async ({ page }) => {
    await start(page);
    await askForPanel();
    await page.getByTestId("offer-skip").click();
    await expect(offerCard(page).getByTestId("offer-outcome")).toHaveText("Skipped");
    await expect(shell(page)).toHaveCount(0);
    await expect.poll(() => team().board.at(-1)?.summary).toBe("Offer skipped.");
  });

  test("Specialist offer is findable: it waits under the hand-off chip in Mochi's chat", async ({ page }) => {
    await start(page);
    await askForPanel();
    const turn = page.getByTestId("agent-turn").last();
    await expect(turn.getByTestId("handoff-chip")).toBeVisible();
    await expect(turn.getByTestId("offer-card")).toBeVisible();
    await expect(turn.getByTestId("offer-agent")).toHaveText("Architect");
  });

  test("Waiting offer while collapsed: the header counts it", async ({ page }) => {
    await start(page);
    await page.getByRole("button", { name: "Hide the agent panel" }).click();
    await askForPanel();
    await expect(page.getByTestId("agent-pending-badge")).toHaveText("1 to approve");
  });

  test("Frame appears before the content: within 150 ms of the nod, with a loading state", async ({
    page,
  }) => {
    await start(page);
    await askForPanel();
    await expect(offerCard(page)).toBeVisible();
    const ms = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const t0 = performance.now();
          const check = () =>
            document.querySelector('[data-testid="generated-panel"]')
              ? resolve(performance.now() - t0)
              : requestAnimationFrame(check);
          window.__HAI_INPUT__?.gestures([{ type: "head.nod", ts: Date.now(), confidence: 1 }]);
          check();
        }),
    );
    expect(ms).toBeLessThan(150);
    await expect(shell(page).getByTestId("panel-done")).toBeVisible();
  });

  test("Declined panel frame is removed: a turn that never supplies it leaves 'No panel was made'", async ({
    page,
  }) => {
    await start(page);
    await askForPanel();
    await expect(offerCard(page)).toBeVisible();
    // Stop the team while the offer waits: the turn ends without a panel.
    await page.getByTestId("team-stop").click();
    await expect(offerCard(page).getByTestId("offer-outcome")).toHaveText("No panel was made");
    await expect(shell(page)).toHaveCount(0);
  });
});

test.describe("nod and shake", () => {
  test("Nod opens the panel: the card shows Opened and the frame appears", async ({ page }) => {
    await start(page);
    await askForPanel();
    await expect(offerCard(page)).toBeVisible();
    await gesture(page, "head.nod");
    await expect(offerCard(page).getByTestId("offer-outcome")).toHaveText("Opened");
    await expect(shell(page)).toBeVisible();
    await expect(frame(page).locator("#s")).toBeVisible();
  });

  test("a nod that is not engaged opens nothing", async ({ page }) => {
    await start(page);
    await page.evaluate(() => window.__HAI_INPUT__?.engaged(false));
    await askForPanel();
    await expect(offerCard(page)).toBeVisible();
    await gesture(page, "head.nod");
    await page.waitForTimeout(300);
    await expect(shell(page)).toHaveCount(0);
    await expect(offerCard(page)).toHaveAttribute("data-state", "waiting");
  });

  test("Shake skips and keeps the tool", async ({ page }) => {
    await start(page);
    await page.keyboard.press("w"); // Wall
    await expect(page.getByTestId("active-tool")).toHaveAttribute("data-tool", "wall");
    await askForPanel();
    await expect(offerCard(page)).toBeVisible();
    await gesture(page, "head.shake");
    await expect(offerCard(page).getByTestId("offer-outcome")).toHaveText("Skipped");
    await expect(page.getByTestId("active-tool")).toHaveAttribute("data-tool", "wall");
  });

  test("Approval is answered before the offer, which keeps waiting", async ({ page }) => {
    await start(page);
    await team().request("delegate architect: panel");
    await expect(offerCard(page)).toBeVisible();
    // A tool call that needs approval from another agent while the offer waits.
    await team().request("delegate reviewer: shell: echo hello");
    await expect(page.getByTestId("approval-card")).toBeVisible();
    await gesture(page, "head.nod");
    // The reviewer's tool call was allowed and its task finished; the offer is still waiting.
    await expect.poll(() => team().board.find((t) => t.agent === "reviewer")?.status).toBe("done");
    await expect(offerCard(page)).toHaveAttribute("data-state", "waiting");
    await expect(shell(page)).toHaveCount(0);
  });

  test("Transcript is answered before the offer, which keeps waiting", async ({ page }) => {
    await start(page);
    await askForPanel();
    await expect(offerCard(page)).toBeVisible();
    await page.evaluate(() => {
      const voice = window.__HAI_VOICE__ as unknown as { review?(text: string): void } | undefined;
      voice?.review?.("hello");
    });
    test.skip(
      !(await page.evaluate(() => Boolean((window.__HAI_VOICE__ as { reviewing?: boolean })?.reviewing))),
      "this build cannot put a transcript under review from a test",
    );
    await gesture(page, "head.nod");
    await expect(shell(page)).toHaveCount(0);
    await expect(offerCard(page)).toHaveAttribute("data-state", "waiting");
  });
});

test.describe("the panel shell", () => {
  test("Move the panel: dragging its header 200 pixels left moves it and keeps it in the window", async ({
    page,
  }) => {
    await start(page);
    await openClearancePanel(page);
    const header = shell(page).getByTestId("panel-header");
    const before = await box(shell(page));
    const grab = await box(header);
    await page.mouse.move(grab.x + 60, grab.y + grab.height / 2);
    await page.mouse.down();
    await page.mouse.move(grab.x + 60 - 200, grab.y + grab.height / 2, { steps: 8 });
    await page.mouse.up();
    const after = await box(shell(page));
    expect(Math.round(before.x - after.x)).toBe(200);
    expect(Math.round(after.y)).toBe(Math.round(before.y));
    const size = page.viewportSize();
    expect(after.x).toBeGreaterThanOrEqual(0);
    expect(after.x + after.width).toBeLessThanOrEqual(size?.width ?? 0);
    // Dragged far past the edge, it stops inside the window.
    await page.mouse.move(after.x + 60, after.y + 20);
    await page.mouse.down();
    await page.mouse.move(-500, -500, { steps: 6 });
    await page.mouse.up();
    const corner = await box(shell(page));
    expect(corner.x).toBeGreaterThanOrEqual(0);
    expect(corner.y).toBeGreaterThanOrEqual(0);
  });

  test("Panel cannot hide the frame controls: Done and Close stay visible and pressable", async ({
    page,
  }) => {
    await start(page);
    const cover =
      "<style>html,body{position:fixed;inset:0;margin:0;background:red;z-index:2147483647}</style>" +
      '<h1 id="big" style="position:fixed;top:-9999px;left:-9999px;width:99999px;height:99999px">cover</h1>';
    await askForPanel(cover);
    await expect(offerCard(page)).toBeVisible();
    await page.getByTestId("offer-open").click();
    await expect(shell(page)).toHaveAttribute("data-status", "ready");
    const panel = await box(shell(page));
    const frameBox = await box(page.getByTestId("panel-frame"));
    expect(frameBox.width).toBeLessThanOrEqual(panel.width);
    await expect(shell(page).getByTestId("panel-done")).toBeVisible();
    await expect(shell(page).getByTestId("panel-close")).toBeVisible();
    const afterwards = await box(shell(page));
    expect(afterwards.width).toBe(panel.width);
    await shell(page).getByTestId("panel-close").click();
    await expect(shell(page)).toHaveCount(0);
  });

  test("a failed panel shows it in the header, with the reason, and the app keeps working", async ({
    page,
  }) => {
    await start(page);
    await askForPanel("<script>throw new Error('boom on load')</script><p>x</p>");
    await expect(offerCard(page)).toBeVisible();
    await page.getByTestId("offer-open").click();
    await expect(shell(page).getByTestId("panel-failed")).toBeVisible();
    await expect(shell(page).getByTestId("panel-reason")).toContainText("boom on load");
    await expect(page.getByTestId("agent-input")).toBeEnabled();
  });
});

test.describe("the panel and the model", () => {
  test("Nothing picked through the panel, and Navigation continues outside it", async ({ page }) => {
    await start(page);
    // Find a point of the model that the default panel will cover.
    await openClearancePanel(page);
    const rect = await box(shell(page));
    const viewer = await box(page.getByTestId("viewer"));
    const inside = [
      (rect.x + rect.width / 2 - viewer.x) / viewer.width,
      (rect.y + 40 - viewer.y) / viewer.height,
    ];
    expect(await page.evaluate(([x, y]) => window.__HAI_VIEWER__?.pick(x ?? 0, y ?? 0), inside)).toBeNull();
    // Orbit with the mouse outside the panel: the view moves.
    const before = await page.evaluate(() => JSON.stringify(window.__HAI_VIEWER__?.camera()));
    const free = [viewer.x + viewer.width * 0.72, viewer.y + viewer.height * 0.35] as const;
    await page.mouse.move(free[0], free[1]);
    await page.mouse.down();
    await page.mouse.move(free[0] + 80, free[1] + 10, { steps: 6 });
    await page.mouse.up();
    const after = await page.evaluate(() => JSON.stringify(window.__HAI_VIEWER__?.camera()));
    expect(after).not.toBe(before);
  });

  test("Orbit while the panel loads: the view moves while the agent has not supplied the panel", async ({
    page,
  }) => {
    await start(page);
    await askForPanel("wait 6000");
    await expect(offerCard(page)).toBeVisible();
    await page.getByTestId("offer-open").click();
    await expect(page.getByTestId("panel-loading")).toBeVisible();
    const viewer = await box(page.getByTestId("viewer"));
    const before = await page.evaluate(() => JSON.stringify(window.__HAI_VIEWER__?.camera()));
    const free = [viewer.x + viewer.width * 0.72, viewer.y + viewer.height * 0.35] as const;
    await page.mouse.move(free[0], free[1]);
    await page.mouse.down();
    await page.mouse.move(free[0] + 80, free[1] + 10, { steps: 6 });
    await page.mouse.up();
    expect(await page.evaluate(() => JSON.stringify(window.__HAI_VIEWER__?.camera()))).not.toBe(before);
    // The panel is still waiting for its document: orbiting did not wait for it.
    await expect(page.getByTestId("panel-loading")).toBeVisible();
    await shell(page).getByTestId("panel-close").click();
    await expect(shell(page)).toHaveCount(0);
  });
});

test.describe("switching it off", () => {
  test("Switched off while open: the panel closes", async ({ page }) => {
    await start(page);
    await openClearancePanel(page);
    await openSettings(page, "features");
    await page.getByTestId("feature-generatedPanels").click();
    await expect(shell(page)).toHaveCount(0);
    await closeSettings(page);
    expect(Object.keys(await sceneOf(page)).length).toBeGreaterThan(0);
  });
});
