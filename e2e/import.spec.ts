import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import type { Bridge } from "../apps/bridge/src/server.ts";
import { createBridge } from "../apps/bridge/src/server.ts";
import { E2E_ORIGINS } from "./stack.ts";
import { openViewer, startTestBridge } from "./viewer.ts";

// Importing a Rhino model: the picker and the drop, the report, one undo, a restart, and the token on the assets.
const MODELS = join(import.meta.dirname, "..", "test-assets", "models");
const model = (name: string) => join(MODELS, name);

let bridge: (Bridge & { port: number }) | null = null;
test.afterEach(async () => {
  await bridge?.stop();
  bridge = null;
});

async function start(page: Page) {
  bridge = await startTestBridge(page);
  await openViewer(page);
}

type Imported = {
  id: string;
  type: string;
  name: string;
  layer?: string;
  color?: string;
  bounds: { min: number[]; max: number[] };
};
const importedElements = (page: Page) =>
  page.evaluate(
    () =>
      Object.values(window.__HAI_SCENE__?.getSnapshot().doc?.elements ?? {}).filter(
        (e) => e.type === "imported",
      ) as unknown as Imported[],
  );

const meshCount = (page: Page) => page.evaluate(() => window.__HAI_VIEWER__?.meshCount() ?? 0);

/** Hands a file to the page the way the browser does when it is dropped from Explorer. */
async function dragFile(page: Page, name: string, bytes: Buffer, phase: "over" | "drop") {
  await page.evaluate(
    ({ name, base64, phase }) => {
      const w = window as unknown as { __dt?: DataTransfer };
      if (!w.__dt) {
        w.__dt = new DataTransfer();
        w.__dt.items.add(new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], name));
      }
      const target = document.querySelector("[data-testid=viewer]") as HTMLElement;
      const fire = (type: string) =>
        target.dispatchEvent(new DragEvent(type, { dataTransfer: w.__dt, bubbles: true, cancelable: true }));
      if (phase === "over") {
        fire("dragenter");
        fire("dragover");
      } else {
        fire("drop");
        w.__dt = undefined;
      }
    },
    { name, base64: bytes.toString("base64"), phase },
  );
}

test("the Import button imports a .3dm: objects appear, the report counts them, and it is one undo", async ({
  page,
}) => {
  await start(page);
  const before = await meshCount(page);
  await page.getByTestId("import-input").setInputFiles(model("meshes-and-breps.3dm"));
  await expect(page.getByTestId("import-summary")).toContainText("Imported 5 objects", { timeout: 30_000 });
  await expect.poll(() => importedElements(page).then((e) => e.length)).toBe(5);
  await expect.poll(() => meshCount(page)).toBe(before + 5);
  const names = (await importedElements(page)).map((e) => e.name).sort();
  expect(names).toEqual(["Brep 1", "Brep 2", "Mesh 1", "Mesh 2", "Mesh 3"]);

  // The triangles came from the stored model: the imported box can be hit, not just drawn.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          for (let y = 0.05; y < 1; y += 0.025) {
            for (let x = 0.05; x < 1; x += 0.025) {
              if (window.__HAI_VIEWER__?.pick(x, y)?.startsWith("imp-")) return true;
            }
          }
          return false;
        }),
      { timeout: 15_000 },
    )
    .toBe(true);

  await page.getByTestId("import-close").click();
  await expect(page.getByTestId("import-report")).toHaveCount(0);
  // One undo takes all five away; redo brings them back.
  await page.getByTitle("Undo (Ctrl+Z)").click();
  await expect.poll(() => importedElements(page).then((e) => e.length)).toBe(0);
  await page.getByTitle("Redo (Ctrl+Shift+Z)").click();
  await expect.poll(() => importedElements(page).then((e) => e.length)).toBe(5);
});

test("dropping a .3dm on the viewer imports it, with a message while the file is over", async ({ page }) => {
  await start(page);
  const bytes = readFileSync(model("metres-box.3dm"));
  await dragFile(page, "metres-box.3dm", bytes, "over");
  await expect(page.getByTestId("import-drop")).toBeVisible();
  await dragFile(page, "metres-box.3dm", bytes, "drop");
  await expect(page.getByTestId("import-drop")).toHaveCount(0);
  await expect(page.getByTestId("import-summary")).toContainText("Imported 1 object", { timeout: 30_000 });
  // Saved in metres, 2 m wide: 2000 mm in the scene.
  const [box] = await importedElements(page);
  expect((box?.bounds.max[0] ?? 0) - (box?.bounds.min[0] ?? 0)).toBe(2000);
});

test("layers and colours are kept, and the report lists what was skipped", async ({ page }) => {
  await start(page);
  await page.getByTestId("import-input").setInputFiles(model("layers-and-colours.3dm"));
  await expect(page.getByTestId("import-summary")).toContainText("Imported 2 objects", { timeout: 30_000 });
  const elements = await importedElements(page);
  expect(elements.find((e) => e.name === "Red panel")).toMatchObject({ layer: "Facade", color: "#ff0000" });

  await page.getByTestId("import-close").click();
  await page.getByTestId("import-input").setInputFiles(model("with-curves-and-note.3dm"));
  await expect(page.getByTestId("import-summary")).toContainText(
    "4 curves drawn as thin tubes. Skipped 1: 1 annotation",
    {
      timeout: 30_000,
    },
  );
});

test("a file that is not a Rhino file, and a picture, change nothing and say why", async ({ page }) => {
  await start(page);
  await page.getByTestId("import-input").setInputFiles(model("not-a-3dm.3dm"));
  await expect(page.getByTestId("import-error")).toContainText("could not be read as a Rhino file", {
    timeout: 30_000,
  });
  expect(await importedElements(page)).toHaveLength(0);
  await page.getByTestId("import-close").click();

  await dragFile(page, "photo.png", Buffer.from("not really a picture"), "over");
  await dragFile(page, "photo.png", Buffer.from("not really a picture"), "drop");
  await expect(page.getByTestId("import-error")).toContainText("Only .3dm files can be imported");
  expect(await importedElements(page)).toHaveLength(0);
});

test("the imported model survives a restart of the bridge without the original file", async ({ page }) => {
  await start(page);
  await page.getByTestId("import-input").setInputFiles(model("meshes-and-breps.3dm"));
  await expect.poll(() => importedElements(page).then((e) => e.length), { timeout: 30_000 }).toBe(5);
  await page.waitForTimeout(600); // the autosave (200 ms in these tests)

  const { port, scene } = bridge as Bridge & { port: number };
  const projectDir = scene.projectDir as string;
  const token = `viewer-e2e-${port}-0123456789`;
  await bridge?.stop();
  bridge = Object.assign(
    createBridge({
      host: "127.0.0.1",
      port,
      allowedOrigins: E2E_ORIGINS,
      version: "e2e",
      token,
      scene: { projectDir, saveDelayMs: 200 },
    }),
    { port },
  );
  await bridge.start();
  await page.reload();
  await expect.poll(() => importedElements(page).then((e) => e.length), { timeout: 30_000 }).toBe(5);
  // And their triangles load again from the stored asset.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          for (let y = 0.05; y < 1; y += 0.025) {
            for (let x = 0.05; x < 1; x += 0.025) {
              if (window.__HAI_VIEWER__?.pick(x, y)?.startsWith("imp-")) return true;
            }
          }
          return false;
        }),
      { timeout: 15_000 },
    )
    .toBe(true);
});

test("a model can only be fetched or stored with the session token", async ({ page }) => {
  await start(page);
  const port = bridge?.port ?? 0;
  const result = await page.evaluate(async (port) => {
    const url = `http://127.0.0.1:${port}/assets/0f8fad5b-d9cb-469f-a165-70867728950e`;
    const read = await fetch(url);
    const write = await fetch(url, { method: "PUT", body: "x" });
    return [read.status, write.status];
  }, port);
  expect(result).toEqual([401, 401]);
});

test("a section cuts imported geometry like any other", async ({ page }) => {
  await start(page);
  // Only the imported model in view: nothing else to hide it.
  await page.evaluate(() => {
    const scene = window.__HAI_SCENE__;
    const ids = Object.keys(scene?.getSnapshot().doc?.elements ?? {});
    scene?.apply(
      "Clear",
      ids.map((id) => ({ op: "delete", id })),
    );
  });
  await page.getByTestId("import-input").setInputFiles(model("meshes-and-breps.3dm"));
  await expect.poll(() => importedElements(page).then((e) => e.length), { timeout: 30_000 }).toBe(5);
  // Mesh 3 is a box 2000 x 2000 x 3000 mm at x = 6000 (clear of the panels on the left): aim at its roof.
  const roof = async () => page.evaluate(() => window.__HAI_VIEWER__?.project([7000, 1000, 3000]));
  await expect
    .poll(
      async () => {
        const at = await roof();
        return at ? page.evaluate(([x, y]) => window.__HAI_VIEWER__?.pick(x, y), at) : null;
      },
      { timeout: 15_000 },
    )
    .toMatch(/^imp-/);

  await page.keyboard.press("s");
  await expect(page.getByTestId("section-status")).toBeVisible();
  const box = await page.getByTestId("viewer").boundingBox();
  if (!box) throw new Error("no viewer");
  // Grab the plane at the middle of its outline, wherever the camera has it, and drag down.
  const outline = (await page.evaluate(() => window.__HAI_VIEWER__?.sectionOutline())) ?? [];
  expect(outline.length).toBeGreaterThan(2);
  const cx = outline.reduce((sum, p) => sum + p[0], 0) / outline.length;
  const cy = outline.reduce((sum, p) => sum + p[1], 0) / outline.length;
  await page.mouse.move(box.x + box.width * cx, box.y + box.height * cy);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * cx, box.y + box.height * (cy + 0.15), { steps: 8 });
  await page.mouse.move(box.x + box.width * cx, box.y + box.height * (cy + 0.3), { steps: 8 });
  await page.mouse.up();
  const height = await page.evaluate(() => window.__HAI_TOOLS__?.getSnapshot().overlay.sectionMm ?? 0);
  expect(height).toBeLessThan(3000);
  const at = await roof();
  const hit = at ? await page.evaluate(([x, y]) => window.__HAI_VIEWER__?.pick(x, y), at) : null;
  expect(hit ?? "").not.toMatch(/^imp-/);
});

test("a model whose file is gone opens as boxes, and the status names the file", async ({ page }) => {
  await start(page);
  await page.getByTestId("import-input").setInputFiles(model("meshes-and-breps.3dm"));
  await expect.poll(() => importedElements(page).then((e) => e.length), { timeout: 30_000 }).toBe(5);
  await page.waitForTimeout(600);

  const { port, scene } = bridge as Bridge & { port: number };
  const projectDir = scene.projectDir as string;
  const token = `viewer-e2e-${port}-0123456789`;
  await bridge?.stop();
  for (const name of readdirSync(join(projectDir, "assets"))) rmSync(join(projectDir, "assets", name));
  bridge = Object.assign(
    createBridge({
      host: "127.0.0.1",
      port,
      allowedOrigins: E2E_ORIGINS,
      version: "e2e",
      token,
      scene: { projectDir, saveDelayMs: 200 },
    }),
    { port },
  );
  await bridge.start();
  await page.reload();
  // The five elements are still there, drawn as boxes, and the project status says what is missing.
  await expect.poll(() => importedElements(page).then((e) => e.length), { timeout: 30_000 }).toBe(5);
  await expect(page.getByTestId("project-status")).toContainText(".haimesh", { timeout: 15_000 });
});

test("a detailed model is drawn in its colours, not black, and its selection shows", async ({ page }) => {
  await start(page);
  await page.getByTestId("import-input").setInputFiles(model("dense-facade.3dm"));
  await expect.poll(() => importedElements(page).then((e) => e.length), { timeout: 30_000 }).toBe(3);
  await page.waitForTimeout(1500);

  /** The share of near-black pixels on the model's canvas where an imported element is. */
  const darkShare = () =>
    page.evaluate(() => {
      const canvas = document.querySelector("[data-testid=viewer] canvas") as HTMLCanvasElement;
      const copy = document.createElement("canvas");
      copy.width = canvas.width;
      copy.height = canvas.height;
      const ctx = copy.getContext("2d") as CanvasRenderingContext2D;
      ctx.drawImage(canvas, 0, 0);
      let dark = 0;
      let model = 0;
      for (let y = 0.05; y < 1; y += 0.01) {
        for (let x = 0.05; x < 1; x += 0.01) {
          if (!window.__HAI_VIEWER__?.pick(x, y)?.startsWith("imp-")) continue;
          const [r = 0, g = 0, b = 0] = ctx.getImageData(
            Math.floor(x * canvas.width),
            Math.floor(y * canvas.height),
            1,
            1,
          ).data;
          model++;
          if (0.2126 * r + 0.7152 * g + 0.0722 * b < 60) dark++;
        }
      }
      return { dark, model };
    });
  const { dark, model: pixels } = await darkShare();
  expect(pixels).toBeGreaterThan(50);
  expect(dark / pixels).toBeLessThan(0.05);

  // Selecting one lights it up in the selection colour.
  const ids = (await importedElements(page)).map((e) => e.id);
  await page.evaluate((id) => window.__HAI_SCENE__?.select([id]), ids[0] as string);
  await page.waitForTimeout(500);
  await expect(page.getByTestId("selection-status")).toContainText("Facade");
});
