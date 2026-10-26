import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { defaultRoster } from "../apps/bridge/src/agent/roster.ts";
import type { Team } from "../apps/bridge/src/agent/team.ts";
import type { Bridge } from "../apps/bridge/src/server.ts";
import { fakeProvider } from "../apps/bridge/test/fake-provider.ts";
import { connectFakeRhino, rhinoBatch, rhinoObject } from "../apps/bridge/test/rhino-client.ts";
import { closeSettings, openSettings } from "./settings.ts";
import { openViewer, startTestBridge } from "./viewer.ts";

// Agents working on separate parts of the model at the same time: who holds what is listed in the panel, the model
// shows who owns what, and Parallel modelling and Show owners switch it off.

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

async function start(page: Page) {
  bridge = await startTestBridge(page, { agent: fakeProvider(mkdtempSync(join(tmpdir(), "hai-e2e-par-"))) });
  await openViewer(page);
  await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
  await expect(page.getByTestId("agent-status")).toHaveAttribute("data-state", "idle");
}

const column = (id: string, x: number, tags: Record<string, string> = {}) => ({
  op: "create",
  element: {
    id,
    name: id,
    type: "column",
    properties: {},
    position: [x, -4000],
    section: [400, 400],
    height: 3000,
    tags,
  },
});

/** Seeds one element in each of two parts, owned by their agents, and one nobody owns. */
async function seed(page: Page) {
  await page.evaluate(
    (ops) => window.__HAI_SCENE__?.apply("seed", ops),
    [
      column("dome-1", 0, { "hai.owner": "architect", "hai.part": "dome" }),
      column("hall-1", 4000, { "hai.owner": "product", "hai.part": "hall" }),
      column("free-1", 8000),
    ],
  );
  await expect.poll(() => page.evaluate(() => window.__HAI_VIEWER__?.meshCount())).toBeGreaterThanOrEqual(3);
}

const wear = (page: Page, id: string) => page.evaluate((i) => window.__HAI_VIEWER__?.wear?.(i) ?? null, id);

test.describe("who holds what", () => {
  test("two disjoint tasks: the panel lists both parts, the chips say what each holds, and the model shows who owns what", async ({
    page,
  }) => {
    await start(page);
    await seed(page);
    await team().request("delegate architect[dome]: work 8000 | product[hall]: work 8000");
    const parts = page.getByTestId("parts-list");
    await expect(parts.getByTestId("part-row")).toHaveCount(2);
    await expect(parts.getByTestId("part-row").first()).toContainText("Architect");
    await expect(parts.getByTestId("part-row").first()).toContainText("part dome");
    await expect(parts.getByTestId("part-row").first()).toContainText("1 element");
    await expect(page.getByTestId("team-chip-scope-architect")).toHaveText("part dome");
    await expect(page.getByTestId("team-chip-scope-product")).toHaveText("part hall");

    // Owned elements wear their owner's colour: an outline in it, and a tint that an unowned element lacks.
    await expect.poll(() => wear(page, "dome-1").then((w) => w?.outline)).toBe(colorOf("architect"));
    expect((await wear(page, "hall-1"))?.outline).toBe(colorOf("product"));
    expect((await wear(page, "free-1"))?.outline).toBeNull();
    expect((await wear(page, "dome-1"))?.color).not.toBe((await wear(page, "free-1"))?.color);

    // Selection stays on top: the selected element shows the selection colour, not its owner's.
    const free = (await wear(page, "free-1"))?.color;
    await page.evaluate(() => window.__HAI_SCENE__?.select(["dome-1"]));
    await expect.poll(() => wear(page, "dome-1").then((w) => w?.outline)).toBeNull();
    expect((await wear(page, "dome-1"))?.color).not.toBe(free);
    await page.evaluate(() => window.__HAI_SCENE__?.select([]));
    await expect.poll(() => wear(page, "dome-1").then((w) => w?.outline)).toBe(colorOf("architect"));
  });

  test("pointing at a claim in the panel lights its elements, and only its elements", async ({ page }) => {
    await start(page);
    await seed(page);
    await team().request("delegate architect[dome]: work 8000 | product[hall]: work 8000");
    const row = page.locator('[data-testid="part-row"]', { hasText: "Product" });
    await expect(row).toBeVisible();
    await row.hover();
    await expect.poll(() => wear(page, "hall-1").then((w) => w?.glow)).toBe(colorOf("product"));
    expect((await wear(page, "dome-1"))?.glow).toBeNull();
    expect((await wear(page, "free-1"))?.glow).toBeNull();
    await page.mouse.move(5, 5);
    await expect.poll(() => wear(page, "hall-1").then((w) => w?.glow)).toBeNull();
  });

  test("a task waiting on a claim says whose it waits for, and starts when it ends", async ({ page }) => {
    await start(page);
    await seed(page);
    await team().request("delegate architect[dome]: work 2500 | product[dome]: work 100");
    await expect(page.getByTestId("team-chip-scope-product")).toHaveText("waits for Architect's task");
    await expect(page.getByTestId("part-waiting")).toContainText("waits for Architect's task");
    // When Architect's task ends the claim is released and Product's starts.
    await expect(page.getByTestId("part-waiting")).toHaveCount(0, { timeout: 8000 });
    await expect(page.getByTestId("team-chip-product")).toHaveAttribute("data-state", /working|idle/);
  });

  test("a region claim is drawn as a box until its task ends", async ({ page }) => {
    await start(page);
    await seed(page);
    await team().request("delegate architect(-5000,-9000,12000,2000): work 3000");
    await expect.poll(() => page.evaluate(() => window.__HAI_VIEWER__?.claimBoxes?.().length)).toBe(1);
    await expect(page.getByTestId("part-row")).toContainText("region");
    await team().settled();
    await expect.poll(() => page.evaluate(() => window.__HAI_VIEWER__?.claimBoxes?.().length)).toBe(0);
  });

  test("Show owners off: no tint and no box, but the panel still lists the claims", async ({ page }) => {
    await start(page);
    await seed(page);
    await team().request("delegate architect(-5000,-9000,12000,2000): work 8000");
    await expect.poll(() => wear(page, "dome-1").then((w) => w?.outline)).toBe(colorOf("architect"));
    await openSettings(page, "modelling");
    await page.getByTestId("show-owners").click();
    await expect.poll(() => wear(page, "dome-1").then((w) => w?.outline)).toBeNull();
    expect(await page.evaluate(() => window.__HAI_VIEWER__?.claimBoxes?.().length)).toBe(0);
    await expect(page.getByTestId("part-row")).toHaveCount(1);
  });
});

test.describe("switched off, and Rhino", () => {
  test("Parallel modelling off: no owner tint, no boxes, no highlight", async ({ page }) => {
    await start(page);
    await seed(page);
    await openSettings(page, "features");
    await page.getByTestId("feature-parallelModelling").click();
    await closeSettings(page);
    await team().request("delegate architect(-5000,-9000,12000,2000): work 5000");
    await expect(page.getByTestId("part-row")).toHaveCount(1);
    expect((await wear(page, "dome-1"))?.outline).toBeNull();
    expect(await page.evaluate(() => window.__HAI_VIEWER__?.claimBoxes?.().length)).toBe(0);
  });

  test("Rhino objects that carry hai.owner wear their owner's colour too", async ({ page }) => {
    await start(page);
    const rhino = await connectFakeRhino(
      { port: (bridge as Bridge & { port: number }).port } as AddressInfo,
      {
        token: (bridge as Bridge & { token: string }).token,
      },
    );
    const asset = await rhino.uploadMesh(1000, [0, 0, 0]);
    rhino.send(
      "rhino.objects",
      rhinoBatch({
        reset: true,
        changed: [
          rhinoObject("r-owned", asset, { tags: { "hai.owner": "product" } }),
          rhinoObject("r-free", asset, { tags: {} }),
        ],
      }),
    );
    await team().request("delegate product[hall]: work 6000");
    await expect(page.getByTestId("part-row")).toHaveCount(1);
    await expect
      .poll(async () => (await wear(page, "r-owned"))?.color !== (await wear(page, "r-free"))?.color)
      .toBe(true);
    rhino.ws.close();
  });
});

test.describe("the speed of it", () => {
  test("a claim is in the panel within 200 ms of being granted (p90)", async ({ page }) => {
    await start(page);
    // The page notes when each part row first appears; the bridge notes when it granted the claim.
    await page.evaluate(() => {
      const seen: Record<string, number> = {};
      (window as unknown as { __seen: Record<string, number> }).__seen = seen;
      new MutationObserver(() => {
        for (const row of document.querySelectorAll('[data-testid="part-row"]')) {
          const id = row.getAttribute("data-claim");
          if (id && seen[id] === undefined) seen[id] = performance.timeOrigin + performance.now();
        }
      }).observe(document.body, { childList: true, subtree: true });
    });
    const delays: number[] = [];
    for (let run = 0; run < 8; run++) {
      await team().request(`delegate architect[dome${run}]: work 400`);
      await team().settled();
    }
    const seen = await page.evaluate(() => (window as unknown as { __seen: Record<string, number> }).__seen);
    // A row carries its task's id; the task started just after its claim was granted.
    for (const task of team().board) {
      const at = seen[task.id];
      if (at !== undefined && task.startedAt) delays.push(at - task.startedAt);
    }
    expect(delays.length).toBeGreaterThanOrEqual(6);
    delays.sort((a, b) => a - b);
    const p90 = delays[Math.floor(delays.length * 0.9) - 1] ?? delays.at(-1) ?? 0;
    console.log(`claim to panel p90: ${Math.round(p90)} ms over ${delays.length} runs`);
    expect(p90).toBeLessThan(200);
  });
});
