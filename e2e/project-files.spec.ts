import { mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import type { Bridge } from "../apps/bridge/src/server.ts";
import { closeSettings, openSettings } from "./settings.ts";
import { openViewer, startTestBridge } from "./viewer.ts";

// A new project with a clean space, saving the project as a Rhino file, and snapping and measuring at every height.
const MODELS = join(import.meta.dirname, "..", "test-assets", "models");
let bridge: (Bridge & { port: number }) | null = null;
test.afterEach(async () => {
  await bridge?.stop();
  bridge = null;
});

type Point3 = [number, number, number];
type El = {
  id: string;
  type: string;
  name: string;
  level?: string;
  base?: number;
  start?: number[];
  end?: number[];
};

async function start(page: Page) {
  bridge = await startTestBridge(page);
  await openViewer(page);
}

const elements = (page: Page) =>
  page.evaluate(
    () => Object.values(window.__AEX_SCENE__?.getSnapshot().doc?.elements ?? {}) as unknown as El[],
  );

/** Starts a new project in a fresh folder and waits for it to open empty. */
async function newProject(page: Page, name = "fresh") {
  const dir = join(mkdtempSync(join(tmpdir(), "aex-new-")), name);
  await page.getByTestId("new-project").click();
  await page.getByTestId("project-path").fill(dir);
  await page.getByTestId("project-submit").click();
  await expect(page.getByTestId("project-status")).toContainText(name, { timeout: 15_000 });
  await expect.poll(async () => (await elements(page)).length).toBe(0);
  return dir;
}

/** Where a point in the scene (mm) is on the page, px, if it is clear of panels. */
async function clientOf(page: Page, [x, y, z]: Point3): Promise<[number, number] | null> {
  return page.evaluate(
    ([x, y, z]) => {
      const canvas = document.querySelector("[data-testid=viewer] canvas");
      const rect = canvas?.getBoundingClientRect();
      const at = window.__AEX_VIEWER__?.project([x, y, z]);
      if (!rect || !at) return null;
      const px = rect.left + at[0] * rect.width;
      const py = rect.top + at[1] * rect.height;
      const clear = [
        [0, 0],
        [40, 0],
        [-40, 0],
        [0, 40],
        [0, -40],
      ].every(([dx = 0, dy = 0]) => document.elementFromPoint(px + dx, py + dy) === canvas);
      return clear ? [px, py] : null;
    },
    [x, y, z] as const,
  );
}

test("a new project opens with a clean space: nothing in it, then a model imported or a wall drawn", async ({
  page,
}) => {
  await start(page);
  expect((await elements(page)).length).toBeGreaterThan(10); // the sample building, to begin with
  const dir = await newProject(page);
  expect(readFileSync(join(dir, "scene.aex.json"), "utf8")).toContain('"elements": {}');

  // Draw in it: a wall on the ground level, the only element.
  await page.keyboard.press("w");
  const from = await clientOf(page, [-4000, -2000, 0]);
  const to = await clientOf(page, [4000, -2000, 0]);
  if (!from || !to) throw new Error("the ground is not in view");
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 4 });
  await page.mouse.move(to[0], to[1], { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await elements(page)).length).toBe(1);
  const [wall] = await elements(page);
  expect(wall).toMatchObject({ type: "wall", level: "L0" });

  // Import into it: only the model and the wall are there.
  await page.getByTestId("import-input").setInputFiles(join(MODELS, "metres-box.3dm"));
  await expect(page.getByTestId("import-summary")).toContainText("Imported 1 object", { timeout: 30_000 });
  expect((await elements(page)).map((e) => e.type).sort()).toEqual(["imported", "wall"]);
});

test("a folder that already holds a project is not overwritten, and the message says so", async ({
  page,
}) => {
  await start(page);
  const before = (await elements(page)).length;
  const existing = bridge?.scene.projectDir as string;
  await page.getByTestId("new-project").click();
  await page.getByTestId("project-path").fill(existing);
  await page.getByTestId("project-submit").click();
  await expect(page.getByTestId("project-message")).toContainText("already holds a project");
  expect((await elements(page)).length).toBe(before);
});

test("Save as 3dm downloads a Rhino file of the project, which imports again", async ({ page }) => {
  await start(page);
  await newProject(page, "tower");
  await page.getByTestId("import-input").setInputFiles(join(MODELS, "meshes-and-breps.3dm"));
  await expect.poll(async () => (await elements(page)).length, { timeout: 30_000 }).toBe(5);
  // And a drawn column, on the ground level.
  await page.evaluate(() => {
    window.__AEX_SCENE__?.apply("Add column", [
      {
        op: "create",
        element: {
          id: "col-1",
          type: "column",
          name: "Column 1",
          level: "L0",
          properties: {},
          position: [-3000, -3000],
          section: [400, 400],
          height: 3000,
        },
      },
    ]);
  });
  await expect.poll(async () => (await elements(page)).length).toBe(6);

  const download = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByTestId("save-3dm").click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("tower.3dm");
  await expect(page.getByTestId("export-summary")).toContainText("Saved 6 objects", { timeout: 30_000 });
  const saved = join(mkdtempSync(join(tmpdir(), "aex-save-")), "tower.3dm");
  await file.saveAs(saved);

  // Read back with the Rhino reader itself: millimetres, a column extrusion on Columns, five meshes on Imported.
  const rhino = await (
    createRequire(import.meta.url)(
      join(import.meta.dirname, "..", "apps", "web", "node_modules", "rhino3dm", "rhino3dm.js"),
    ) as () => Promise<{
      File3dm: {
        fromByteArray(b: Uint8Array): {
          objects(): {
            count: number;
            get(i: number): { geometry(): object; attributes(): { name: string } };
          };
        };
      };
    }>
  )();
  const back = rhino.File3dm.fromByteArray(new Uint8Array(readFileSync(saved)));
  expect(back.objects().count).toBe(6);
  const names = Array.from({ length: 6 }, (_, i) => back.objects().get(i).attributes().name).sort();
  expect(names).toContain("Column 1");
  expect(names).toContain("Brep 1");

  // The page's importer reads it again, and counts every object.
  await page.getByTestId("export-close").click();
  await page.getByTestId("import-input").setInputFiles(saved);
  await expect(page.getByTestId("import-summary")).toContainText("Imported 6 objects", { timeout: 30_000 });
});

test("an empty project has nothing to save, and no file is offered", async ({ page }) => {
  await start(page);
  await newProject(page);
  let downloaded = false;
  page.on("download", () => {
    downloaded = true;
  });
  await page.getByTestId("save-3dm").click();
  await expect(page.getByTestId("export-error")).toContainText("nothing to save");
  await page.waitForTimeout(500);
  expect(downloaded).toBe(false);
});

test("Endpoint snaps to the top corner of an imported building, and the wall is placed at that height", async ({
  page,
}) => {
  await start(page);
  await newProject(page);
  await page.getByTestId("import-input").setInputFiles(join(MODELS, "meshes-and-breps.3dm"));
  await expect.poll(async () => (await elements(page)).length, { timeout: 30_000 }).toBe(5);
  await openSettings(page, "drawing-aids");
  await page.getByTestId("aid-endpoint").click();
  await closeSettings(page);

  // Mesh 3 is a box 6000..8000 by 0..2000, 3000 high. Its top corner (8000, 2000, 3000) is far from where the ground
  // ray under it lands.
  const top = await clientOf(page, [8000, 2000, 3000]);
  if (!top) throw new Error("the corner is not clear on screen");
  await page.keyboard.press("w");
  await page.mouse.move(top[0] + 9, top[1] + 6);
  await expect(page.getByTestId("snap-label")).toHaveText("Endpoint");
  const marker = await page.getByTestId("snap-label").getAttribute("data-point");
  expect(marker).toBe("8000,2000");

  // Draw a wall from that corner to a free point on the roof plane.
  const far = await clientOf(page, [8000 - 5000, 2000, 3000]);
  if (!far) throw new Error("the roof is not clear on screen");
  await page.mouse.down();
  await page.mouse.move((top[0] + far[0]) / 2, (top[1] + far[1]) / 2, { steps: 4 });
  await page.mouse.move(far[0], far[1], { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await elements(page)).filter((e) => e.type === "wall").length).toBe(1);
  const wall = (await elements(page)).find((e) => e.type === "wall") as El;
  expect(wall.start).toEqual([8000, 2000]);
  expect(wall.base).toBe(3000);
  expect(wall.level).toBeUndefined();
});

test("Measure snaps to corners at different heights and shows the across and up parts", async ({ page }) => {
  await start(page);
  await newProject(page);
  await page.getByTestId("import-input").setInputFiles(join(MODELS, "meshes-and-breps.3dm"));
  await expect.poll(async () => (await elements(page)).length, { timeout: 30_000 }).toBe(5);
  await openSettings(page, "drawing-aids");
  await page.getByTestId("aid-endpoint").click();
  await closeSettings(page);

  // A bottom corner of Mesh 3 that is clear on screen, and its top corner (8000, 2000, 3000): 3000 up.
  const top = await clientOf(page, [8000, 2000, 3000]);
  let bottom: [number, number] | null = null;
  let corner: [number, number] = [0, 0];
  for (const c of [
    [8000, 0],
    [6000, 2000],
    [6000, 0],
    [8000, 2000],
  ] as Array<[number, number]>) {
    bottom = await clientOf(page, [c[0], c[1], 0]);
    if (bottom) {
      corner = c;
      break;
    }
  }
  if (!bottom || !top) throw new Error("the corners are not clear on screen");
  const across = Math.round(Math.hypot(8000 - corner[0], 2000 - corner[1]));
  const straight = Math.round(Math.hypot(across, 3000));
  await page.keyboard.press("d");
  await page.mouse.click(bottom[0] + 7, bottom[1] + 5);
  await page.mouse.click(top[0] - 6, top[1] - 4);
  await expect(page.getByTestId("tool-notice")).toContainText(`${straight} mm (${across} across, 3000 up)`);
});
