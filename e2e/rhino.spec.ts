import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import type { Team } from "../apps/bridge/src/agent/team.ts";
import type { Bridge } from "../apps/bridge/src/server.ts";
import { fakeProvider } from "../apps/bridge/test/fake-provider.ts";
import { sharedPythonEnv } from "../apps/bridge/test/python-env.ts";
import { connectFakeRhino, rhinoBatch, rhinoObject } from "../apps/bridge/test/rhino-client.ts";
import { openSettings } from "./settings.ts";
import { camera, findElementOnScreen, openViewer, startTestBridge } from "./viewer.ts";

// Rhino next to HAI: a fake Rhino plugin connects the way the real one does, and the viewer draws its model.

// One real managed environment (kept between runs); null where no Python 3.10 or newer is installed.
const env = await sharedPythonEnv().catch(() => null);

let bridge: (Bridge & { port: number }) | null = null;
const sockets: FakeRhino["ws"][] = [];

test.afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.close();
  await bridge?.stop();
  bridge = null;
});

function team(): Team {
  if (!bridge?.agent) throw new Error("the bridge has no agent team");
  return bridge.agent;
}

type FakeRhino = Awaited<ReturnType<typeof connectFakeRhino>>;

async function start(page: Page, options: Parameters<typeof startTestBridge>[1] = {}) {
  bridge = await startTestBridge(page, options);
  await openViewer(page);
  return bridge;
}

const connect = (
  options: { document?: string; python?: Parameters<typeof connectFakeRhino>[1]["python"] } = {},
): Promise<FakeRhino> => {
  if (!bridge) throw new Error("no bridge");
  return connectFakeRhino({ port: bridge.port } as AddressInfo, {
    token: bridge.token,
    document: options.document ?? "tower.3dm",
    ...(options.python ? { python: options.python } : {}),
    track: sockets,
  });
};

type Corner = [number, number, number];

/** Puts one object (a triangle 1 m wide at `at`) into Rhino's document, with its mesh uploaded first. */
async function addObject(rhino: FakeRhino, id: string, at: Corner, color: string | null = null) {
  const asset = await rhino.uploadMesh(1000, at);
  rhino.send(
    "rhino.objects",
    rhinoBatch({
      changed: [
        rhinoObject(id, asset, {
          color,
          bounds: { min: at, max: [at[0] + 1000, at[1] + 1000, at[2]] },
        }),
      ],
    }),
  );
}

/** Opens a document the way the plugin does: every mesh uploaded, then one first batch that replaces whatever was held. */
async function loadModel(rhino: FakeRhino, objects: Array<{ id: string; at: Corner; color?: string }>) {
  const assets = await Promise.all(objects.map((o) => rhino.uploadMesh(1000, o.at)));
  rhino.send(
    "rhino.objects",
    rhinoBatch({
      reset: true,
      changed: objects.map((o, n) =>
        rhinoObject(o.id, assets[n] ?? null, {
          color: o.color ?? null,
          bounds: { min: o.at, max: [o.at[0] + 1000, o.at[1] + 1000, o.at[2]] },
        }),
      ),
    }),
  );
}

const mirrorObjects = (page: Page) =>
  page.evaluate(() => window.__HAI_MIRROR__?.getSnapshot().objects.map((o) => o.id) ?? []);
const mirrorState = (page: Page) => page.evaluate(() => window.__HAI_MIRROR__?.getSnapshot());
const sceneIds = (page: Page) =>
  page.evaluate(() => Object.keys(window.__HAI_SCENE__?.getSnapshot().doc?.elements ?? {}));

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

/** Taps (clicks) where an element of the viewer is, as a user would. */
async function tap(page: Page, id: string) {
  await cameraSettled(page);
  const [x, y] = await findElementOnScreen(page, id);
  const canvas = await page.locator("[data-testid=viewer] canvas").boundingBox();
  if (!canvas) throw new Error("the viewer is not laid out");
  await page.mouse.click(canvas.x + x * canvas.width, canvas.y + y * canvas.height);
}

test.describe("the mirror layer", () => {
  test("the Rhino model is drawn: objects Rhino reports can be seen and picked here", async ({ page }) => {
    await start(page);
    const rhino = await connect();
    await loadModel(rhino, [
      { id: "rhino-wall", at: [-12000, -6000, 0], color: "#cc4422" },
      { id: "rhino-slab", at: [-9000, -6000, 0] },
    ]);
    await expect.poll(() => mirrorObjects(page)).toEqual(["rhino-wall", "rhino-slab"]);
    await expect(page.getByTestId("rhino-status")).toHaveText("Rhino connected");
    await expect.poll(() => findElementOnScreen(page, "rhino-wall").catch(() => null)).not.toBeNull();
    await expect.poll(() => findElementOnScreen(page, "rhino-slab").catch(() => null)).not.toBeNull();
  });

  test("the mirror is not saved: the scene, its history and the project stay as they were", async ({
    page,
  }) => {
    const b = await start(page);
    const before = await sceneIds(page);
    const rhino = await connect();
    await loadModel(rhino, [{ id: "rhino-wall", at: [-12000, -6000, 0] }]);
    await expect.poll(() => mirrorObjects(page)).toEqual(["rhino-wall"]);
    await expect.poll(() => findElementOnScreen(page, "rhino-wall").catch(() => null)).not.toBeNull();
    expect(await sceneIds(page)).toEqual(before);
    const history = await page.evaluate(() => window.__HAI_SCENE__?.getSnapshot());
    expect(history?.canUndo).toBe(false);
    expect(history?.lastChange).toBeNull();
    // Give the project's autosave time to run, then look for the object in every file of the project folder.
    await page.waitForTimeout(600);
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else files.push(path);
      }
    };
    expect(b.scene.projectDir).not.toBeNull();
    walk(b.scene.projectDir ?? "");
    for (const file of files) expect(readFileSync(file).includes("rhino-wall")).toBe(false);
  });

  test("a tap selects in Rhino, and what is selected in Rhino shows here", async ({ page }) => {
    await start(page);
    const rhino = await connect();
    await loadModel(rhino, [
      { id: "rhino-wall", at: [-12000, -6000, 0] },
      { id: "rhino-slab", at: [-9000, -6000, 0] },
    ]);
    await expect.poll(() => findElementOnScreen(page, "rhino-wall").catch(() => null)).not.toBeNull();
    await tap(page, "rhino-wall");
    await rhino.waitFor("rhino.select", (m) => m.payload.ids.join() === "rhino-wall");
    // Rhino answers with its selection; the layer shows it.
    rhino.send("rhino.selection", { objects: [{ id: "rhino-wall", type: "brep", layer: "Default" }] });
    await expect.poll(async () => (await mirrorState(page))?.selection).toEqual(["rhino-wall"]);
    // Selecting in Rhino alone is shown too.
    rhino.send("rhino.selection", { objects: [{ id: "rhino-slab", type: "brep", layer: "Default" }] });
    await expect.poll(async () => (await mirrorState(page))?.selection).toEqual(["rhino-slab"]);
  });

  test("the first sync and what is not drawn are said", async ({ page }) => {
    await start(page);
    const rhino = await connect();
    rhino.send(
      "rhino.objects",
      rhinoBatch({
        reset: true,
        sync: { done: 5, total: 50 },
        notDrawn: { curves: 12, points: 0, annotations: 1, other: 0, heavy: 0 },
      }),
    );
    await expect(page.getByTestId("rhino-status")).toHaveText("Syncing 5 of 50");
    await openSettings(page, "modelling");
    await expect(page.getByTestId("modelling-sync")).toContainText("Syncing 5 of 50");
    await expect(page.getByTestId("modelling-not-drawn")).toContainText(
      "12 curves and 1 annotation not drawn",
    );
  });
});

test.describe("Settings > Modelling", () => {
  test("Automatic follows the connection", async ({ page }) => {
    await start(page);
    await openSettings(page, "modelling");
    await expect(page.getByTestId("modelling-in-use-value")).toHaveText("Python only");
    await expect(page.getByTestId("modelling-connection")).toContainText("Not connected");
    const rhino = await connect();
    await addObject(rhino, "rhino-wall", [-12000, -6000, 0]);
    await expect(page.getByTestId("modelling-in-use-value")).toHaveText("Rhino");
    await expect(page.getByTestId("modelling-connection")).toContainText("Connected to tower.3dm");
    expect(bridge?.rhino.inUse).toBe("rhino");
    rhino.ws.close();
    await expect(page.getByTestId("modelling-in-use-value")).toHaveText("Python only");
    await expect.poll(() => mirrorObjects(page)).toEqual([]);
  });

  test("Python inside Rhino: ready, or why not and what to do", async ({ page }) => {
    await start(page);
    const rhino = await connect({ python: { state: "unavailable", reason: "no Python 3 engine" } });
    await openSettings(page, "modelling");
    await expect(page.getByTestId("modelling-python-status")).toContainText(
      "Python not available in Rhino: no Python 3 engine",
    );
    await expect(page.getByTestId("modelling-python-status")).toContainText("run HaiConnect again");
    // Rhino reports it works now.
    rhino.send("rhino.status", { python: { state: "ready" }, document: "tower.3dm" });
    await expect(page.getByTestId("modelling-python-status")).toContainText("Python ready");
  });

  test("Python only hides the Rhino tools from the agent and the mirror layer", async ({ page }) => {
    await start(page);
    const rhino = await connect();
    await addObject(rhino, "rhino-wall", [-12000, -6000, 0]);
    await expect.poll(() => mirrorObjects(page)).toEqual(["rhino-wall"]);
    await openSettings(page, "modelling");
    await page.getByTestId("modelling-python").click();
    await expect(page.getByTestId("modelling-python")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("modelling-in-use-value")).toHaveText("Python only");
    await expect(page.getByTestId("rhino-status")).toHaveText("Python only");
    await expect.poll(() => mirrorObjects(page)).toEqual([]);
    expect(bridge?.rhino.inUse).toBe("python");
    expect(bridge?.rhino.mirrored).toBe(false);
    // Back to Automatic: the model comes back without Rhino doing anything.
    await page.getByTestId("modelling-auto").click();
    await expect.poll(() => mirrorObjects(page)).toEqual(["rhino-wall"]);
    expect(bridge?.rhino.inUse).toBe("rhino");
  });

  test("the choice follows the workspace", async ({ page, browser }) => {
    const root = mkdtempSync(join(tmpdir(), "hai-e2e-modelling-"));
    await start(page, { root });
    await openSettings(page, "modelling");
    await page.getByTestId("modelling-python").click();
    await expect(page.getByTestId("modelling-python")).toHaveAttribute("aria-pressed", "true");
    await bridge?.stop();
    bridge = null;
    // The same workspace opened again, in another browser.
    const other = await browser.newContext();
    const second = await other.newPage();
    bridge = await startTestBridge(second, { root });
    await openViewer(second);
    await openSettings(second, "modelling");
    await expect(second.getByTestId("modelling-python")).toHaveAttribute("aria-pressed", "true");
    await other.close();
  });
});

test.describe("Rhino to HAI latency", () => {
  test("a change in Rhino is drawn within the budget, and the readout says how long it took", async ({
    page,
  }) => {
    await start(page);
    const rhino = await connect();
    // A document of 50 objects, then an edit that moves all of them.
    const place = (n: number, shift: number): Corner => [
      (n % 10) * 1500 - 7000 + shift,
      Math.floor(n / 10) * 1500 - 3500,
      0,
    ];
    const send = async (shift: number, first: boolean) => {
      const assets = await Promise.all(
        Array.from({ length: 50 }, (_, n) => rhino.uploadMesh(1000, place(n, shift))),
      );
      // The plugin stamps a batch when it sends it, after its meshes are uploaded (the meshing is the plugin's own time).
      const changedAt = Date.now();
      rhino.send(
        "rhino.objects",
        rhinoBatch({
          reset: first,
          changedAt,
          changed: assets.map((asset, n) => {
            const at = place(n, shift);
            return rhinoObject(`obj-${n}`, asset, {
              bounds: { min: at, max: [at[0] + 1000, at[1] + 1000, at[2]] },
            });
          }),
        }),
      );
    };
    await send(0, true);
    await expect.poll(() => mirrorObjects(page).then((ids) => ids.length)).toBe(50);
    for (let edit = 1; edit <= 10; edit++) {
      await send(edit * 100, false);
      await page.waitForTimeout(150);
    }
    await expect
      .poll(() => page.evaluate(() => window.__HAI_MIRROR__?.latencyP90() ?? null), { timeout: 10_000 })
      .not.toBeNull();
    const p90 = await page.evaluate(() => window.__HAI_MIRROR__?.latencyP90() ?? 0);
    console.log(`Rhino to HAI p90 for a 50-object edit: ${Math.round(p90)} ms`);
    expect(p90).toBeLessThan(300);
    await expect(page.getByTestId("rhino-latency")).toHaveText(/^Rhino to HAI \d+ ms$/);
  });
});

test.describe("the agent sets the view", () => {
  const ask = (team: Team, view: string) => team.request(`delegate architect: view ${view}`);
  const withAgent = async (page: Page) => {
    await start(page, { agent: fakeProvider(mkdtempSync(join(tmpdir(), "hai-e2e-rhino-"))) });
    await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
    await expect(page.getByTestId("agent-status")).toHaveAttribute("data-state", "idle");
    return team();
  };

  test("the camera goes to the view, which animates there", async ({ page }) => {
    const team = await withAgent(page);
    await ask(team, '{"azimuth":225,"elevation":35,"distance":24000}');
    await expect
      .poll(async () => {
        const c = await camera(page);
        return [Math.round(c.azimuth), Math.round(c.elevation), Math.round(c.distance)];
      })
      .toEqual([225, 35, 24]);
  });

  test("it can frame a Rhino object by its id", async ({ page }) => {
    const team = await withAgent(page);
    const rhino = await connect();
    await addObject(rhino, "rhino-far", [40_000, 40_000, 0]);
    await expect.poll(() => mirrorObjects(page)).toEqual(["rhino-far"]);
    await ask(team, '{"frame":["rhino-far"]}');
    // The box centre in metres.
    await expect
      .poll(async () => {
        const c = await camera(page);
        return [Math.round(c.target[0]), Math.round(c.target[1])];
      })
      .toEqual([41, 41]);
  });

  test("navigating by hand during the animation takes over", async ({ page }) => {
    const team = await withAgent(page);
    const start = await camera(page);
    expect(start.elevation).toBeLessThan(60);
    const canvas = await page.locator("[data-testid=viewer] canvas").boundingBox();
    if (!canvas) throw new Error("the viewer is not laid out");
    const x = canvas.x + canvas.width / 2;
    const y = canvas.y + canvas.height / 2;
    // The user orbits sideways without a pause; the agent's request lands somewhere in the middle of it.
    await page.mouse.move(x, y);
    await page.mouse.down();
    await ask(team, '{"elevation":85}');
    const status = page.getByTestId("agent-status");
    for (let i = 0; i < 400; i++) {
      await page.mouse.move(x + (i % 20) * 2, y, { steps: 1 });
      await page.waitForTimeout(25);
      if (i > 20 && (await status.getAttribute("data-state")) === "idle") break;
    }
    // A few more moves, covering the whole animation after the request was delivered.
    for (let i = 0; i < 24; i++) {
      await page.mouse.move(x + (i % 20) * 2, y, { steps: 1 });
      await page.waitForTimeout(25);
    }
    await page.mouse.up();
    await page.waitForTimeout(600);
    // The request did reach the viewer (the agent was told "View set."), and still the user's hand won.
    await expect(page.getByText(/View set\./).first()).toBeVisible();
    expect((await camera(page)).elevation).toBeLessThan(60);
  });
});

test.describe("files the agent's Python wrote", () => {
  const box = join(import.meta.dirname, "..", "test-assets", "models", "metres-box.3dm");
  test.skip(!env, "needs a Python 3.10 or newer on this machine");

  async function runPython(page: Page, request: string) {
    await start(page, {
      agent: fakeProvider(mkdtempSync(join(tmpdir(), "hai-e2e-python-"))),
      ...(env ? { pythonEnv: env } : {}),
    });
    await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
    await expect(page.getByTestId("agent-status")).toHaveAttribute("data-state", "idle");
    await team().request(`delegate architect: ${request}`);
    const card = page.getByTestId("approval-card").last();
    await expect(card).toHaveAttribute("data-outcome", "pending");
    return card;
  }

  test("a written .3dm is offered, the scene is untouched, and Import puts it in the viewer", async ({
    page,
  }) => {
    const card = await runPython(page, `python write ${box}`);
    await card.getByRole("button", { name: "Allow", exact: true }).click();
    const files = page.getByTestId("written-files");
    await expect(files).toBeVisible();
    await expect(files.getByTestId("written-file")).toHaveCount(1);
    await expect(files).toContainText("written-box.3dm");
    // Nothing is imported until the user chooses it; Open in Rhino needs Rhino.
    expect(await sceneIds(page).then((ids) => ids.filter((id) => id.startsWith("imp")))).toEqual([]);
    await expect(files.getByTestId("written-open")).toHaveCount(0);
    const before = (await sceneIds(page)).length;
    await files.getByTestId("written-import").click();
    await expect.poll(async () => (await sceneIds(page)).length).toBeGreaterThan(before);
    await expect(files).toHaveCount(0);
  });

  test("rhino3dm writes a box through the helper, and it imports at its real size", async ({ page }) => {
    const card = await runPython(page, "python box");
    await card.getByRole("button", { name: "Allow", exact: true }).click();
    const files = page.getByTestId("written-files");
    await expect(files).toContainText("box.3dm");
    await files.getByTestId("written-import").click();
    const imported = () =>
      page.evaluate(
        () =>
          Object.values(window.__HAI_SCENE__?.getSnapshot().doc?.elements ?? {}).filter(
            (e) => e.type === "imported",
          ) as unknown as Array<{ name: string; bounds: { min: number[]; max: number[] } }>,
      );
    await expect.poll(() => imported().then((e) => e.length)).toBe(1);
    const [box] = await imported();
    expect(box?.name).toBe("Box");
    expect(box?.bounds.max.map((v, k) => v - (box?.bounds.min[k] ?? 0))).toEqual([2000, 1000, 3000]);
  });

  test("with Rhino connected the file can be opened there", async ({ page }) => {
    const card = await runPython(page, `python write ${box}`);
    const rhino = await connect();
    await card.getByRole("button", { name: "Allow", exact: true }).click();
    await page.getByTestId("written-open").click();
    const opened = await rhino.waitFor("rhino.open");
    expect(opened.payload.path).toMatch(/written-box\.3dm$/);
    await expect(page.getByTestId("written-files")).toHaveCount(0);
  });

  test("the approval card shows the whole script, scrollable, and what would be installed", async ({
    page,
  }) => {
    const card = await runPython(page, "python packages ladybug-core");
    const code = card.getByTestId("approval-code");
    await expect(code).toContainText("import ladybug");
    await expect(code).toContainText("# study step 60");
    const { scrolls, tall } = await code.evaluate((el) => ({
      scrolls: el.scrollHeight > el.clientHeight,
      tall: el.clientHeight,
    }));
    expect(scrolls).toBe(true);
    expect(tall).toBeLessThanOrEqual(200);
    await expect(card.getByTestId("approval-installs")).toContainText("ladybug-core");
    await card.getByRole("button", { name: "Deny" }).click();
    // A specialist's card goes with its decision; the agent is told it was declined, and nothing was installed.
    await expect(page.getByText("Python refused: The user declined this tool call.")).toBeVisible();
  });
});
