import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import type { Team } from "../apps/bridge/src/agent/team.ts";
import type { Bridge } from "../apps/bridge/src/server.ts";
import { fakeProvider } from "../apps/bridge/test/fake-provider.ts";
import { connectFakeHost, hostBatch, hostObject } from "../apps/bridge/test/host-client.ts";
import { camera, findElementOnScreen, openViewer, startTestBridge } from "./viewer.ts";

// HAI is where the user edits what the hosts model: Move, Rotate and Delete on a host's objects go to the host as one
// step each, Undo follows the order of the user's edits wherever they were made, and a host selection has a card with
// Ask about this. A fake connector stands in for Rhino.

let bridge: (Bridge & { port: number }) | null = null;
const sockets: FakeHost["ws"][] = [];

test.afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.close();
  await (bridge?.agent as Team | null)?.stopAll();
  await bridge?.stop();
  bridge = null;
});

type FakeHost = Awaited<ReturnType<typeof connectFakeHost>>;
type Corner = [number, number, number];

async function start(page: Page, withAgent = false) {
  bridge = await startTestBridge(
    page,
    withAgent ? { agent: fakeProvider(mkdtempSync(join(tmpdir(), "hai-e2e-edit-"))) } : {},
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await openViewer(page);
  const rhino = await connectFakeHost({ port: bridge.port } as AddressInfo, {
    token: bridge.token,
    track: sockets,
  });
  return rhino;
}

/** Opens a Rhino document of 2 m squares at these corners, the way the plugin does. */
async function loadModel(rhino: FakeHost, objects: Array<{ id: string; at: Corner; name?: string }>) {
  const assets = await Promise.all(objects.map((o) => rhino.uploadMesh(2000, o.at)));
  rhino.send(
    "host.objects",
    hostBatch({
      reset: true,
      changed: objects.map((o, n) =>
        hostObject(o.id, assets[n] ?? null, {
          ...(o.name ? { name: o.name } : {}),
          bounds: { min: o.at, max: [o.at[0] + 2000, o.at[1] + 2000, o.at[2]] },
        }),
      ),
    }),
  );
}

/** The object again, as Rhino reports it after an edit moved it to `at`. */
async function moved(rhino: FakeHost, id: string, at: Corner) {
  const asset = await rhino.uploadMesh(2000, at);
  rhino.send(
    "host.objects",
    hostBatch({
      changed: [hostObject(id, asset, { bounds: { min: at, max: [at[0] + 2000, at[1] + 2000, 0] } })],
    }),
  );
}

/**
 * Selects objects in Rhino: the selection goes out, and the bridge's request to describe it is answered with
 * `components`, the way the plugin answers it.
 */
async function select(rhino: FakeHost, ids: string[], components: typeof COMPONENTS | null = null) {
  const before = rhino.received.filter((m) => m.type === "host.describe").length;
  rhino.send("host.selection", { objects: ids.map((id) => ({ id, type: "brep", layer: "Roof::Canopy" })) });
  if (!components) return;
  const ask = await rhino.waitFor(
    "host.describe",
    (m) => rhino.received.filter((r) => r.type === "host.describe").indexOf(m) >= before,
  );
  rhino.send("host.described", { id: ask.payload.id, components });
}

const mirror = (page: Page) => page.evaluate(() => window.__HAI_MIRROR__?.byHost.rhino?.getSnapshot());

/** Waits until the camera has not moved for 400 ms (framing a new model animates it). */
async function cameraSettled(page: Page) {
  let last = "";
  let since = Date.now();
  await expect
    .poll(async () => {
      const now = JSON.stringify(await camera(page));
      if (now !== last) {
        last = now;
        since = Date.now();
      }
      return Date.now() - since >= 400;
    })
    .toBe(true);
}

/** Where an object is on screen, px, once the view has settled. */
async function screenOf(page: Page, id: string): Promise<{ x: number; y: number }> {
  await cameraSettled(page);
  const [x, y] = await findElementOnScreen(page, id);
  const canvas = await page.locator("[data-testid=viewer] canvas").boundingBox();
  if (!canvas) throw new Error("the viewer is not laid out");
  return { x: canvas.x + x * canvas.width, y: canvas.y + y * canvas.height };
}

/** Drags with the mouse from an object to `dx` px to the right of it. */
async function dragRight(page: Page, id: string, dx: number) {
  const at = await screenOf(page, id);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + dx / 2, at.y, { steps: 4 });
  await page.mouse.move(at.x + dx, at.y, { steps: 4 });
  await page.mouse.up();
}

const CANOPY = [
  { id: "canopy-1", at: [-12_000, -6_000, 0] as Corner, name: "Canopy" },
  { id: "canopy-2", at: [-8_000, -6_000, 0] as Corner, name: "Bench" },
];

test.describe("editing a host's objects in HAI", () => {
  test("move a host object by hand: Rhino gets one transform, and the object does not jump back meanwhile", async ({
    page,
  }) => {
    const rhino = await start(page);
    await loadModel(rhino, CANOPY);
    await expect.poll(() => findElementOnScreen(page, "canopy-1").catch(() => null)).not.toBeNull();
    await page.keyboard.press("m");
    await dragRight(page, "canopy-1", 120);
    const edit = await rhino.waitFor("host.edit");
    expect(edit.payload).toMatchObject({ label: "Move Canopy", op: { op: "transform", ids: ["canopy-1"] } });
    const matrix = edit.payload.op.op === "transform" ? edit.payload.op.matrix : [];
    const dx = matrix[3] ?? 0;
    expect(dx).toBeGreaterThan(0);
    expect(dx % 100).toBe(0); // snapped to the 100 mm grid
    // Until Rhino's result arrives, the object is drawn where it was put.
    expect((await mirror(page))?.preview).toEqual({ ids: ["canopy-1"], matrix });
    rhino.send("host.edited", { id: edit.payload.id, ok: true });
    await page.waitForTimeout(200);
    expect((await mirror(page))?.preview?.ids).toEqual(["canopy-1"]);
    await moved(rhino, "canopy-1", [-12_000 + dx, -6_000, 0]);
    await expect.poll(async () => (await mirror(page))?.preview).toBeNull();
    expect((await mirror(page))?.objects.find((o) => o.id === "canopy-1")?.bounds.min[0]).toBe(-12_000 + dx);
  });

  test("a refused edit: the object goes back, and the notice says why", async ({ page }) => {
    const rhino = await start(page);
    await loadModel(rhino, CANOPY);
    await expect.poll(() => findElementOnScreen(page, "canopy-1").catch(() => null)).not.toBeNull();
    await page.keyboard.press("m");
    await dragRight(page, "canopy-1", 120);
    const edit = await rhino.waitFor("host.edit");
    rhino.send("host.edited", {
      id: edit.payload.id,
      ok: false,
      error: "There is no object canopy-1 in Rhino any more.",
    });
    await expect.poll(async () => (await mirror(page))?.preview).toBeNull();
    await expect(page.getByTestId("tool-notice")).toContainText(
      "There is no object canopy-1 in Rhino any more.",
    );
  });

  test("Delete asks first, and Rhino deletes the object as one step", async ({ page }) => {
    const rhino = await start(page);
    await loadModel(rhino, CANOPY);
    await expect.poll(() => findElementOnScreen(page, "canopy-2").catch(() => null)).not.toBeNull();
    await page.keyboard.press("x");
    const at = await screenOf(page, "canopy-2");
    await page.mouse.click(at.x, at.y);
    await expect(page.getByTestId("tool-question")).toContainText("Delete Bench?");
    await page.keyboard.press("Enter");
    const edit = await rhino.waitFor("host.edit");
    expect(edit.payload).toMatchObject({ label: "Delete Bench", op: { op: "delete", ids: ["canopy-2"] } });
  });

  test("undo a host edit, then a scene edit: each goes back where it was made, and Redo goes forward again", async ({
    page,
  }) => {
    const rhino = await start(page);
    const blockX = () =>
      (bridge?.scene.scene.doc.elements["block-b"] as { origin: number[] } | undefined)?.origin[0];
    const startX = blockX();
    await page.keyboard.press("m");
    // A scene edit first (before Rhino's document opens and is framed), then a host edit.
    await dragRight(page, "block-b", 120);
    await expect.poll(blockX).not.toBe(startX);
    await loadModel(rhino, CANOPY);
    await expect.poll(() => findElementOnScreen(page, "canopy-1").catch(() => null)).not.toBeNull();
    await dragRight(page, "canopy-1", 120);
    const edit = await rhino.waitFor("host.edit");
    rhino.send("host.edited", { id: edit.payload.id, ok: true });
    await moved(rhino, "canopy-1", [-10_000, -6_000, 0]);
    await expect.poll(async () => (await mirror(page))?.preview).toBeNull();

    await page.keyboard.press("Control+z");
    await rhino.waitFor("host.undo");
    expect(blockX()).not.toBe(startX); // the scene edit is still there
    await page.keyboard.press("Control+z");
    await expect.poll(blockX).toBe(startX);
    // Redo: the scene edit first (the last undone), then the host edit.
    await page.keyboard.press("Control+Shift+z");
    await expect.poll(blockX).not.toBe(startX);
    expect(rhino.received.some((m) => m.type === "host.redo")).toBe(false);
    await page.keyboard.press("Control+Shift+z");
    await rhino.waitFor("host.redo");
  });

  test("a spoken move on a host object: Rhino gets one transform of 2000 mm along x", async ({ page }) => {
    const rhino = await start(page);
    await loadModel(rhino, CANOPY);
    await select(rhino, ["canopy-1"]);
    await expect.poll(async () => (await mirror(page))?.selection).toEqual(["canopy-1"]);
    await page.evaluate(() => window.__HAI_VOICE__?.hear("move this 2 metres to the right"));
    const edit = await rhino.waitFor("host.edit");
    expect(edit.payload.op).toEqual({
      op: "transform",
      ids: ["canopy-1"],
      matrix: [1, 0, 0, 2000, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    });
  });
});

const COMPONENTS = [
  {
    id: "canopy-1",
    name: "Canopy",
    type: "Closed Brep",
    layer: "Roof::Canopy",
    bounds: null,
    quantities: { areaMm2: 14_200_000, volumeMm3: 3_200_000_000 },
    quantitiesSkipped: false,
    material: "Glulam",
    properties: { fire_rating: "R60", supplier: "Nordwood", phase: "2" },
  },
];

test.describe("the host selection card", () => {
  test("a selected canopy: the card shows what Rhino says it is, and covers no other panel", async ({
    page,
  }) => {
    const rhino = await start(page);
    await loadModel(rhino, CANOPY);
    await select(rhino, ["canopy-1"], COMPONENTS);
    const card = page.getByTestId("component-card");
    await expect(card).toBeVisible();
    await expect(card.getByTestId("component-title")).toHaveText("Canopy");
    const row = card.getByTestId("component-row");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Closed Brep");
    await expect(row).toContainText("Roof::Canopy · 3.2 m³ · Glulam");
    await expect(row).toContainText("R60");
    // The status bar says what is selected, and where.
    await expect(page.getByTestId("selection-status")).toHaveText("Canopy (Rhino)");
    // It moves aside rather than cover another panel, and goes while another tool is active.
    const cardBox = await card.boundingBox();
    for (const other of await page.locator("[data-hud]").all()) {
      if ((await other.getAttribute("data-testid")) === "component-card") continue;
      const box = await other.boundingBox();
      if (!box || !cardBox || !(await other.isVisible())) continue;
      const overlap =
        cardBox.x < box.x + box.width &&
        box.x < cardBox.x + cardBox.width &&
        cardBox.y < box.y + box.height &&
        box.y < cardBox.y + cardBox.height;
      expect(overlap, `covers ${await other.getAttribute("data-testid")}`).toBe(false);
    }
    await page.keyboard.press("m");
    await expect(card).toHaveCount(0);
  });

  test("ask about this: the request is limited to the selection, and the task it hands out is scoped to it", async ({
    page,
  }) => {
    const rhino = await start(page, true);
    await loadModel(rhino, CANOPY);
    await select(rhino, ["canopy-1"], COMPONENTS);
    const card = page.getByTestId("component-card");
    await expect(card).toBeVisible();
    await expect(card.getByTestId("component-ask")).toBeDisabled();
    await card.getByTestId("component-ask-text").fill("delegate architect: work 30000");
    await card.getByTestId("component-ask").click();
    const team = bridge?.agent as Team;
    await expect
      .poll(() => team.board.find((t) => t.agent === "architect")?.scope)
      .toEqual({ ids: ["canopy-1"] });
    await expect(card.getByTestId("component-ask-text")).toHaveValue("");
  });

  test("the changed objects glow: what the agent changed for the request, once the team is done", async ({
    page,
  }) => {
    const rhino = await start(page, true);
    await loadModel(rhino, CANOPY);
    await select(rhino, ["canopy-1"], COMPONENTS);
    const card = page.getByTestId("component-card");
    await expect(card).toBeVisible();
    await card.getByTestId("component-ask-text").fill("delegate architect: work 3000");
    await card.getByTestId("component-ask").click();
    // Mochi hands the work out and its own turn ends at once: the architect's task is what is still running.
    const team = bridge?.agent as Team;
    await expect.poll(() => team.board.find((t) => t.agent === "architect")?.status).toBe("running");
    // While the team works, Rhino reports the canopy changed (as the agent's run would).
    await moved(rhino, "canopy-1", [-12_000, -6_000, 0]);
    // Nothing glows while the architect is still at work, even with Mochi idle.
    await expect(page.getByTestId("agent-status")).toHaveAttribute("data-state", "idle");
    expect((await mirror(page))?.changed).toEqual([]);
    await expect.poll(async () => (await mirror(page))?.changed, { timeout: 15_000 }).toEqual(["canopy-1"]);
    // The next selection ends the glow.
    await select(rhino, ["canopy-2"]);
    await expect.poll(async () => (await mirror(page))?.changed).toEqual([]);
  });

  for (const scheme of ["light", "dark"] as const)
    for (const width of [1280, 1024, 900])
      test(`the card at ${width} px (${scheme})`, async ({ page }, testInfo) => {
        await page.emulateMedia({ colorScheme: scheme });
        const rhino = await start(page);
        await page.setViewportSize({ width, height: 860 });
        await loadModel(rhino, CANOPY);
        await select(rhino, ["canopy-1"], COMPONENTS);
        const card = page.getByTestId("component-card");
        await expect(card).toBeVisible();
        await cameraSettled(page);
        const box = await card.boundingBox();
        const view = await page.getByTestId("viewer").boundingBox();
        expect(box && view && box.x >= view.x && box.x + box.width <= view.x + view.width + 0.5).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`component-card-${width}-${scheme}.png`) });
      });
});
