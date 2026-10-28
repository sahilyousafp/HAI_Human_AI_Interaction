import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { fakeProvider } from "../apps/bridge/test/fake-provider.ts";
import { openViewer, startTestBridge } from "./viewer.ts";

// The agent copies an element along a curve: ordinary elements appear along the line, in one undo step. (The
// OpenCascade tools - loft, sweep, boolean, offset - need the kernel installed, which these tests do not do.)
type Bridge = Awaited<ReturnType<typeof startTestBridge>>;
let bridge: Bridge | null = null;
test.afterEach(async () => {
  await bridge?.stop();
  bridge = null;
});

async function start(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  bridge = await startTestBridge(page, { agent: fakeProvider(mkdtempSync(join(tmpdir(), "hai-e2e-fake-"))) });
  await openViewer(page);
}

/** The lead only hands work out: this first line gives the request to the Architect, who can change the model. */
const FOR_ARCHITECT = "[for: architect]\n";

const ask = async (page: Page, text: string) => {
  await expect(page.getByTestId("agent-status")).toHaveAttribute("data-state", "idle");
  await page.getByTestId("agent-input").fill(text);
  await page.getByTestId("agent-input").press("Enter");
};

const draw = (page: Page, id: string, points: number[][]) =>
  page.evaluate(
    ([lineId, pts]) =>
      window.__HAI_SCENE__?.apply("Draw rail", [
        {
          op: "create",
          element: { id: lineId, name: "Rail", type: "line", points: pts, closed: false, properties: {} },
        },
      ]),
    [id, points] as const,
  );

const columns = () =>
  Object.values(bridge?.scene.scene.doc.elements ?? {}).filter((e) => e.type === "column") as Array<{
    id: string;
    position: [number, number];
    section: [number, number];
    rotationDeg?: number;
  }>;

test("copies a column along a line every 2 m, and one undo takes them all away", async ({ page }) => {
  await start(page);
  await draw(page, "rail", [
    [0, 0, 0],
    [6000, 0, 0],
  ]);
  await expect.poll(() => bridge?.scene.scene.doc.elements.rail?.type).toBe("line");
  const before = columns().length;
  await ask(
    page,
    `${FOR_ARCHITECT}tool geometry_array_along_curve {"element":"col-a1","rail":"rail","spacing":2000}`,
  );
  await expect(page.getByTestId("agent-turn").last()).toContainText("created");
  // 0, 2, 4 and 6 m along the line: four copies, each centred on its place.
  await expect.poll(() => columns().length).toBe(before + 4);
  const copies = columns().filter((c) => c.id !== "col-a1" && c.position[1] === 0);
  expect(copies.map((c) => c.position[0]).sort((a, b) => a - b)).toEqual([0, 2000, 4000, 6000]);

  await page.evaluate(() => window.__HAI_SCENE__?.undo());
  await expect.poll(() => columns().length).toBe(before);
});

test("turns each copy to run along a bent line", async ({ page }) => {
  await start(page);
  await draw(page, "bent", [
    [0, 0, 0],
    [2000, 0, 0],
    [2000, 2000, 0],
  ]);
  await expect.poll(() => bridge?.scene.scene.doc.elements.bent?.type).toBe("line");
  await ask(
    page,
    `${FOR_ARCHITECT}tool geometry_array_along_curve {"element":"col-a1","rail":"bent","spacing":2000}`,
  );
  await expect(page.getByTestId("agent-turn").last()).toContainText("created");
  await expect.poll(() => columns().filter((c) => c.rotationDeg === 90).length).toBe(2);
});

test("a rail that is not a line is refused and nothing is made", async ({ page }) => {
  await start(page);
  const before = columns().length;
  await ask(
    page,
    `${FOR_ARCHITECT}tool geometry_array_along_curve {"element":"col-a1","rail":"col-a1","count":3}`,
  );
  await expect(page.getByTestId("agent-turn").last()).toContainText("not a line");
  expect(columns().length).toBe(before);
});
