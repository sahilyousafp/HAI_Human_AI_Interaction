import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { defaultRoster } from "../apps/bridge/src/agent/roster.ts";
import type { Team } from "../apps/bridge/src/agent/team.ts";
import type { Bridge } from "../apps/bridge/src/server.ts";
import { fakeProvider } from "../apps/bridge/test/fake-provider.ts";
import { closeSettings, openSettings } from "./settings.ts";
import { openViewer, startTestBridge } from "./viewer.ts";

// A specialist splits its own task into parts that other sessions of it make at the same time: they show nested under
// it in its colour, hold their parts, are one undo step each, and are limited by a setting.

let bridge: (Bridge & { port: number }) | null = null;

test.afterEach(async () => {
  await (bridge?.agent as Team | null)?.stopAll();
  await bridge?.stop();
  bridge = null;
});

const team = (): Team => {
  if (!bridge?.agent) throw new Error("the bridge has no agent team");
  return bridge.agent;
};
const colorOf = (name: string) => defaultRoster().find((m) => m.name === name)?.color;
const PAVILION = "delegate architect[pavilion]: ";

async function start(page: Page) {
  bridge = await startTestBridge(page, {
    agent: fakeProvider(mkdtempSync(join(tmpdir(), "hai-e2e-workers-"))),
  });
  await page.setViewportSize({ width: 1600, height: 900 });
  await openViewer(page);
  await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
  await expect(page.getByTestId("agent-status")).toHaveAttribute("data-state", "idle");
}

const wear = (page: Page, id: string) => page.evaluate((i) => window.__HAI_VIEWER__?.wear?.(i) ?? null, id);
const elements = (page: Page) =>
  page.evaluate(() =>
    Object.values(window.__HAI_SCENE__?.getSnapshot().doc?.elements ?? {}).map((e) => ({
      id: e.id as string,
      owner: (e.tags as Record<string, string> | undefined)?.["hai.owner"] ?? null,
    })),
  );

test.describe("workers", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`they nest under their specialist in its colour and fill their parts at the same time (${scheme})`, async ({
      page,
    }, testInfo) => {
      await page.emulateMedia({ colorScheme: scheme });
      await start(page);
      // Slow columns: the checks below need the workers to still be running when a slow runner gets to them.
      await team().request(
        `${PAVILION}spawn dome[pavilion/dome]: columns 5 every 2000 ;; minarets[pavilion/minarets]: columns 5 every 2000`,
      );
      const rows = page.getByTestId("team-workers-architect");
      await expect(rows.getByTestId("team-worker-architect.2")).toBeVisible();
      await expect(rows.getByTestId("team-worker-architect.3")).toBeVisible();
      await expect(rows.getByTestId("team-worker-architect.2")).toContainText("Architect 2");
      await expect(rows.getByTestId("team-worker-architect.2")).toContainText("dome");
      // They run at the same time, and the specialist's own task runs on while it waits for them.
      await expect(rows.getByTestId("team-worker-architect.2")).toHaveAttribute("data-state", "running");
      await expect(rows.getByTestId("team-worker-architect.3")).toHaveAttribute("data-state", "running");
      await expect(page.getByTestId("team-chip-architect")).toHaveAttribute("data-state", "working");
      // In the specialist's colour.
      expect(await rows.getAttribute("style")).toContain(colorOf("architect") ?? "never");
      // Each worker holds its own part, listed under the specialist's, indented.
      await expect(page.getByTestId("part-row")).toHaveCount(3);
      await expect(page.locator('[data-testid="part-row"]').nth(1)).toContainText("Architect 2");
      await expect(page.locator('[data-testid="part-row"]').nth(1)).toContainText("part pavilion/dome");
      await page.screenshot({ path: testInfo.outputPath(`nested-${scheme}.png`) });

      await team().settled();
      const owned = await elements(page);
      expect(owned.filter((e) => e.owner === "architect.2")).toHaveLength(5);
      expect(owned.filter((e) => e.owner === "architect.3")).toHaveLength(5);
      // A worker's elements wear its specialist's colour.
      const [mine] = owned.filter((e) => e.owner === "architect.2");
      await expect
        .poll(() => wear(page, mine?.id as string).then((w) => w?.outline))
        .toBe(colorOf("architect"));
    });
  }

  test("each worker is one undo step, and a worker is refused a part another holds", async ({ page }) => {
    await start(page);
    await team().request(
      `${PAVILION}spawn dome[pavilion/dome]: columns 3 every 200 ;; minarets[pavilion/minarets]: columns 3 every 350`,
    );
    await team().settled();
    const count = async (owner: string) => (await elements(page)).filter((e) => e.owner === owner).length;
    expect([await count("architect.2"), await count("architect.3")]).toEqual([3, 3]);
    // One undo reverts the worker that ended last; the other's part stays.
    await page.evaluate(() => window.__HAI_SCENE__?.undo());
    await expect.poll(() => count("architect.3")).toBe(0);
    expect(await count("architect.2")).toBe(3);
    await page.evaluate(() => window.__HAI_SCENE__?.undo());
    await expect.poll(() => count("architect.2")).toBe(0);
  });

  test("a worker's approval card names the worker, and the specialist's chip waits with it", async ({
    page,
  }) => {
    await start(page);
    await team().request(`${PAVILION}spawn dome[pavilion/dome]: shell: echo workers`);
    const card = page.getByTestId("team-workers-architect").getByTestId("approval-card");
    await expect(card).toBeVisible();
    await expect(card.getByTestId("approval-agent")).toHaveText("Architect 2");
    await expect(page.getByTestId("team-chip-architect")).toHaveAttribute("data-state", "waiting");
    await expect(page.getByTestId("team-worker-architect.2")).toHaveAttribute("data-state", "waiting");
    await card.getByRole("button", { name: "Allow", exact: true }).click();
    await expect.poll(() => team().board.map((t) => t.status)).toEqual(["done", "done"]);
    await team().settled();
  });

  test("Stop all ends the specialist and every worker, queued ones included", async ({ page }) => {
    await start(page);
    await team().request(`${PAVILION}spawn a[pavilion/a]: work 30000 ;; b[pavilion/b]: work 30000`);
    await expect(page.getByTestId("team-worker-architect.3")).toHaveAttribute("data-state", "running");
    await page.getByTestId("team-stop").click();
    // Within 3 seconds the specialist and both workers have ended, and nothing is claimed.
    await expect
      .poll(() => team().board.map((t) => t.status), { timeout: 4000 })
      .toEqual(["stopped", "stopped", "stopped"]);
    await expect(page.getByTestId("part-row")).toHaveCount(0);
  });
});

test.describe("Mochi's plan", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`the user removes a part and confirms, and only the two that are kept are handed out (${scheme})`, async ({
      page,
    }, testInfo) => {
      await page.emulateMedia({ colorScheme: scheme });
      await start(page);
      const turn = team().request(
        "plan architect[dome]: Dome ;; architect[minarets]: Minarets ;; product[garden]: Garden",
      );
      const card = page.getByTestId("plan-card");
      await expect(card).toBeVisible();
      await expect(card.getByTestId("plan-part")).toHaveCount(3);
      await expect(card.getByTestId("plan-part").nth(0)).toContainText("Architect");
      await expect(card.getByTestId("plan-part").nth(0)).toContainText("part dome");
      await expect(card.getByTestId("plan-confirm")).toHaveText("Confirm");
      // Nothing is handed out before the user answers.
      expect(team().board).toHaveLength(0);
      await page.screenshot({ path: testInfo.outputPath(`plan-${scheme}.png`) });
      await card.getByTestId("plan-part-remove").nth(2).click();
      await expect(card.getByTestId("plan-confirm")).toHaveText("Confirm 2 of 3");
      await card.getByTestId("plan-confirm").click();
      await expect(card).toHaveAttribute("data-outcome", "confirmed");
      await expect(card).toContainText("Confirmed: 2 of 3 parts");
      await turn;
      await team().settled();
      expect(
        team()
          .board.map((t) => t.title)
          .sort(),
      ).toEqual(["Dome", "Minarets"]);
    });
  }

  test("Skip hands nothing out, and the last part cannot be removed", async ({ page }) => {
    await start(page);
    void team().request("plan architect[dome]: Dome ;; product[garden]: Garden");
    const card = page.getByTestId("plan-card");
    await card.getByTestId("plan-part-remove").first().click();
    // One part is left: it cannot be removed (skip the plan instead).
    await expect(card.getByTestId("plan-part-remove").last()).toBeDisabled();
    await card.getByTestId("plan-skip").click();
    await expect(card).toHaveAttribute("data-outcome", "skipped");
    await team().settled();
    expect(team().board).toHaveLength(0);
  });
});

test.describe("the limit on sessions", () => {
  test("a worker over the limit waits for a free session, and raising the limit starts it", async ({
    page,
  }) => {
    await start(page);
    // Mochi and Architect are two sessions: with a limit of 3, one worker fits.
    await openSettings(page, "modelling");
    await page.getByTestId("max-sessions-3").click();
    await closeSettings(page);
    await team().request(`${PAVILION}spawn a[pavilion/a]: work 30000 ;; b[pavilion/b]: work 30000`);
    await expect(page.getByTestId("team-worker-state-architect.2")).toHaveText(/pavilion\/a/);
    await expect(page.getByTestId("team-worker-state-architect.3")).toHaveText("waits for a free session");
    await expect(page.getByTestId("part-waiting-session")).toContainText("waits for a free session (3 of 3");
    await openSettings(page, "modelling");
    await page.getByTestId("max-sessions-6").click();
    await closeSettings(page);
    await expect(page.getByTestId("team-worker-architect.3")).toHaveAttribute("data-state", "running");
    await expect(page.getByTestId("part-waiting-session")).toHaveCount(0);
  });
});
