import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import type { Bridge } from "../apps/bridge/src/server.ts";
import { fakeProvider } from "../apps/bridge/test/fake-provider.ts";
import {
  handDraw,
  handEvent,
  handTap,
  holdAt,
  openGround,
  type Point,
  references,
  releaseAt,
  run,
  toolSnapshot,
  viewerOf,
} from "./hands.ts";
import { closeSettings, openSettings } from "./settings.ts";
import { findElementOnScreen, openViewer, startTestBridge } from "./viewer.ts";

// Hold to talk and the two rings set out by role: the dominant hand's action ring, the other hand's reference ring with
// the tools that point things out for the agent (sketches and lettered markers).
let bridge: (Bridge & { port: number }) | null = null;
test.afterEach(async () => {
  await bridge?.stop();
  bridge = null;
});

async function start(page: Page, root?: string) {
  bridge = await startTestBridge(page, root ? { root } : {});
  await openViewer(page);
}

/** A bridge whose agent is the fake Claude Code CLI; returns where it keeps what each session was sent. */
async function startWithFakeAgent(page: Page): Promise<string> {
  const state = mkdtempSync(join(tmpdir(), "hai-e2e-hold-"));
  bridge = await startTestBridge(page, { agent: fakeProvider(state) });
  await openViewer(page);
  return state;
}

/** Everything the fake agent's sessions were sent, in order per session. */
const sentToAgent = (state: string): string[] =>
  readdirSync(state)
    .filter((f) => f.endsWith(".json") && !f.startsWith("mcp"))
    .flatMap((f) => {
      const data = JSON.parse(readFileSync(join(state, f), "utf8"));
      return Array.isArray(data) ? data.filter((x): x is string => typeof x === "string") : [];
    });

const activeTool = (page: Page) => page.getByTestId("active-tool");

test.describe("the rings and the dominant hand", () => {
  test("Setting persists: Dominant hand Left is still Left after a reload, and swaps which hand shows which ring", async ({
    page,
  }) => {
    await start(page);
    await openSettings(page, "rings");
    await expect(page.getByTestId("dominant-hand-right")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("dominant-hand-left").click();
    await expect(page.getByText("a silent long pinch of your left hand, Space")).toBeVisible();
    await page.waitForTimeout(300); // the bridge writes .hai/settings.json
    await page.reload();
    await openSettings(page, "rings");
    await expect(page.getByTestId("dominant-hand-left")).toHaveAttribute("aria-pressed", "true");
  });

  test("the reference ring keeps its own layout after a reload, and the action ring is unchanged", async ({
    page,
  }) => {
    await start(page);
    await openSettings(page, "rings");
    await page.getByTestId("ring-tab-reference").click();
    await expect(page.getByTestId("palette-setting-0")).toHaveValue("sketch-line");
    await page.getByTestId("palette-setting-0").selectOption("");
    await page.waitForTimeout(300);
    await page.reload();
    await openSettings(page, "rings");
    await expect(page.getByTestId("palette-setting-0")).toHaveValue("select");
    await page.getByTestId("ring-tab-reference").click();
    await expect(page.getByTestId("palette-setting-0")).toHaveValue("");
  });

  test("Shortcut chooses a tool: E is Sketch area, L Sketch line, K Place marker", async ({ page }) => {
    await start(page);
    for (const [key, id] of [
      ["e", "sketch-area"],
      ["l", "sketch-line"],
      ["k", "place-marker"],
    ] as const) {
      await page.keyboard.press(key);
      await expect(activeTool(page)).toHaveAttribute("data-tool", id);
    }
  });
});

test.describe("sketches and markers", () => {
  test("Draw a path: an L drawn by the left hand is kept as S1, dashed in its colour, and the model is unchanged", async ({
    page,
  }) => {
    await start(page);
    const [x, y] = await openGround(page, 6000, 4000);
    const before = Object.keys(bridge?.scene.scene.doc.elements ?? {}).length;
    await page.keyboard.press("l");
    await handDraw(page, [
      ...run([x, y], [x + 6000, y]),
      ...run([x + 6000, y], [x + 6000, y + 4000]).slice(1),
    ]);
    await expect.poll(async () => (await references(page)).sketches.length).toBe(1);
    const [sketch] = (await references(page)).sketches;
    expect(sketch).toMatchObject({ label: "S1", kind: "path", hand: "Left" });
    expect(sketch?.points).toHaveLength(3);
    await expect(page.getByTestId("sketch-label")).toHaveText("S1");
    await expect(page.getByTestId("sketch-label")).toHaveAttribute("data-kind", "path");
    expect(Object.keys(bridge?.scene.scene.doc.elements ?? {})).toHaveLength(before);
  });

  test("Too short: a 200 mm path keeps nothing", async ({ page }) => {
    await start(page);
    const [x, y] = await openGround(page, 1000, 1000);
    await page.keyboard.press("l");
    await handDraw(page, [
      [x, y],
      [x + 100, y],
      [x + 200, y],
    ]);
    await expect(page.getByTestId("tool-notice")).toContainText("at least 300 mm");
    expect((await references(page)).sketches).toEqual([]);
  });

  test("Outline a courtyard: a 10 m by 8 m loop is a closed outline of about 80 square metres", async ({
    page,
  }) => {
    await start(page);
    const [x, y] = await openGround(page, 10_000, 8000);
    await page.keyboard.press("e");
    await handDraw(page, [
      ...run([x, y], [x + 10_000, y]),
      ...run([x + 10_000, y], [x + 10_000, y + 8000]).slice(1),
      ...run([x + 10_000, y + 8000], [x, y + 8000]).slice(1),
      ...run([x, y + 8000], [x, y + 1000]).slice(1),
    ]);
    await expect.poll(async () => (await references(page)).sketches.length).toBe(1);
    const [sketch] = (await references(page)).sketches;
    expect(sketch?.kind).toBe("outline");
    let twice = 0;
    const pts = sketch?.points ?? [];
    for (let i = 0; i < pts.length; i++) {
      const [x0 = 0, y0 = 0] = pts[i] ?? [];
      const [x1 = 0, y1 = 0] = pts[(i + 1) % pts.length] ?? [];
      twice += x0 * y1 - x1 * y0;
    }
    expect(Math.abs(twice) / 2 / 1e6).toBeGreaterThan(75);
    expect(Math.abs(twice) / 2 / 1e6).toBeLessThanOrEqual(80.5);
    await expect(page.getByTestId("sketch-label")).toHaveAttribute("data-kind", "outline");
  });

  test("Delete one sketch: tapping S2 with Delete removes only S2, without a question", async ({ page }) => {
    await start(page);
    const [x, y] = await openGround(page, 6000, 6000);
    await page.keyboard.press("l");
    await handDraw(page, run([x, y], [x + 6000, y]));
    await handDraw(page, run([x, y + 6000], [x + 6000, y + 6000]));
    await expect.poll(async () => (await references(page)).sketches.length).toBe(2);
    await page.keyboard.press("x");
    await handTap(page, [x + 3000, y + 6000]);
    await expect.poll(async () => (await references(page)).sketches.map((s) => s.label)).toEqual(["S1"]);
    await expect(page.getByTestId("tool-question")).toHaveCount(0);
  });

  test("A request clears sketches: a typed request carries S1 and S2 to the agent, and the view shows none after", async ({
    page,
  }) => {
    const state = await startWithFakeAgent(page);
    const [x, y] = await openGround(page, 6000, 6000);
    await page.keyboard.press("l");
    await handDraw(page, run([x, y], [x + 6000, y]));
    await handDraw(page, run([x, y + 6000], [x + 6000, y + 6000]));
    await expect(page.getByTestId("sketch-label")).toHaveCount(2);
    await expect(page.getByTestId("agent-status")).toHaveAttribute("data-state", "idle");
    await page.getByTestId("agent-input").fill("a wall along each of these");
    await page.getByTestId("agent-input").press("Enter");
    await expect
      .poll(() => sentToAgent(state).find((t) => t.includes("a wall along each of these")) ?? "")
      .toMatch(
        /^\[context\] [^\n]*\n\[sketches\] S1 path: .* mm; S2 path: .* mm\na wall along each of these$/,
      );
    await expect(page.getByTestId("sketch-label")).toHaveCount(0);
    expect((await references(page)).sketches).toEqual([]);
  });

  test("Escape with a sketch tool clears the sketches; the next Escape returns to Select", async ({
    page,
  }) => {
    await start(page);
    const [x, y] = await openGround(page, 6000, 1000);
    await page.keyboard.press("l");
    await handDraw(page, run([x, y], [x + 6000, y]));
    await expect.poll(async () => (await references(page)).sketches.length).toBe(1);
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await references(page)).sketches.length).toBe(0);
    await expect(activeTool(page)).toHaveAttribute("data-tool", "sketch-line");
    await page.keyboard.press("Escape");
    await expect(activeTool(page)).toHaveAttribute("data-tool", "select");
  });

  test("Two markers, Letters are reused, and Markers survive a restart", async ({ page, browser }) => {
    const workspace = mkdtempSync(join(tmpdir(), "hai-e2e-markers-"));
    await start(page, workspace);
    const [x, y] = await openGround(page, 8000, 8000);
    await page.keyboard.press("k");
    await handTap(page, [x + 1000, y + 1000]);
    await handTap(page, [x + 7000, y + 7000]);
    await expect(page.getByTestId("letter-marker")).toHaveCount(2);
    expect((await references(page)).markers.map((m) => m.letter)).toEqual(["A", "B"]);
    // Removing A and placing another gives the new one A again.
    await handTap(page, [x + 1000, y + 1000]);
    await expect(page.getByTestId("letter-marker")).toHaveCount(1);
    await handTap(page, [x + 4000, y + 4000]);
    await expect.poll(async () => (await references(page)).markers.map((m) => m.letter)).toEqual(["A", "B"]);
    const placed = (await references(page)).markers;
    // The bridge has saved both with the project before it stops.
    const saved = join(workspace, "project", ".hai", "markers.json");
    await expect
      .poll(() => (existsSync(saved) ? JSON.parse(readFileSync(saved, "utf8")) : null))
      .toEqual(placed);

    // The bridge keeps them with the project: a restarted bridge and a reloaded page show the same markers.
    await bridge?.stop();
    bridge = null;
    await page.close();
    // A page keeps the session it was given, so a fresh one meets the new bridge (in its own context: a second page of
    // the same context is never in front, and the view would never draw).
    const { baseURL, viewport } = test.info().project.use;
    const again = await (await browser.newContext({ baseURL, viewport })).newPage();
    await start(again, workspace);
    await expect(again.getByTestId("letter-marker")).toHaveCount(2);
    expect((await references(again)).markers).toEqual(placed);
  });
});

test.describe("hold to talk", () => {
  const mic = (page: Page) => page.getByTestId("mic-indicator");
  const engage = (page: Page) => page.evaluate(() => window.__HAI_INPUT__?.engaged(true));

  /** The hand's pointer at a viewer position, as tracking would send it every frame (the chip sits beside it). */
  const pointAt = async (page: Page, at: Point, hand: "Left" | "Right" = "Right") => {
    const position = await page.evaluate(([x, y]) => window.__HAI_VIEWER__?.handAt(x, y), at);
    await page.evaluate(
      ([p, h]) =>
        window.__HAI_INPUT__?.pointer(
          h === "Right" ? (p as Point) : null,
          h === "Left" ? (p as Point) : null,
        ),
      [position, hand] as const,
    );
  };

  /** Hands that do not snap to models, so what is exactly under the pointer (or nothing) is what a hold locks. */
  async function noModelSnap(page: Page) {
    await openSettings(page, "features");
    const snap = page.getByTestId("feature-snapToModels");
    if ((await snap.getAttribute("aria-checked")) === "true") await snap.click();
    await expect(snap).toHaveAttribute("aria-checked", "false");
    await closeSettings(page);
  }

  test("Hold on a wall: the wall is the locked target, the microphone is on and a chip shows beside the hand", async ({
    page,
  }) => {
    await start(page);
    await engage(page);
    const at = await findElementOnScreen(page, "block-c");
    await pointAt(page, at, "Left");
    await holdAt(page, at, "Left");
    await expect(mic(page)).toHaveAttribute("data-state", "on");
    expect((await toolSnapshot(page)).held).toMatchObject({
      target: { kind: "element", id: "block-c" },
      hand: "Left",
    });
    await expect(page.getByTestId("held-chip")).toBeVisible();
    await expect(page.getByTestId("held-chip")).toHaveAttribute("data-hand", "left");
    await expect(page.getByTestId("hand-pointer-left")).toHaveAttribute("data-mode", "talk");
    // The agent panel stays as it was: a held request shows beside the hand, not in the voice bar.
    await expect(page.getByTestId("voice-bar")).toHaveCount(0);
    await releaseAt(page, at, "Left");
    await expect(mic(page)).toHaveAttribute("data-state", "off");
    expect((await toolSnapshot(page)).held).toBeNull();
    await expect(page.getByTestId("held-chip")).toHaveCount(0);
  });

  test("Hold on empty ground: the target is the ground point, marked", async ({ page }) => {
    await start(page);
    await noModelSnap(page);
    await engage(page);
    const [x, y] = await openGround(page, 2000, 2000, { empty: true });
    const at = (await viewerOf(page, [x + 1000, y + 1000])) as Point;
    await holdAt(page, at, "Left");
    const { held } = await toolSnapshot(page);
    expect(held?.target).toMatchObject({ kind: "point", aid: null });
    await expect(page.getByTestId("held-target")).toBeVisible();
    await releaseAt(page, at, "Left");
    await expect(page.getByTestId("held-target")).toHaveCount(0);
  });

  test("Hold near a wall end: with Endpoint on, the target is the wall end and the marker names Endpoint", async ({
    page,
  }) => {
    await start(page);
    await noModelSnap(page);
    await openSettings(page, "drawing-aids");
    await page.getByTestId("aid-endpoint").click();
    await closeSettings(page);
    await engage(page);
    // A wall on open ground, and a spot on the ground 250 mm past its end, clear of it.
    const [x, y] = await openGround(page, 6000, 2000, { empty: true });
    const wall = { start: [x + 1000, y + 1000] as Point, end: [x + 4000, y + 1000] as Point };
    await page.evaluate(
      (w) =>
        window.__HAI_SCENE__?.apply("Add Wall", [
          {
            op: "create",
            element: {
              id: "wall-hold",
              name: "Wall hold",
              type: "wall",
              level: "L0",
              properties: {},
              start: w.start,
              end: w.end,
              height: 3000,
              thickness: 200,
            },
          },
        ]),
      wall,
    );
    await expect.poll(() => bridge?.scene.scene.doc.elements["wall-hold"]).toBeDefined();
    const beside = (await viewerOf(page, [wall.end[0] + 250, wall.end[1]])) as Point;
    expect(await page.evaluate(([vx, vy]) => window.__HAI_VIEWER__?.pick(vx, vy), beside)).toBeNull();
    await holdAt(page, beside, "Left");
    const { held } = await toolSnapshot(page);
    expect(held?.target).toEqual({ kind: "point", point: [wall.end[0], wall.end[1], 0], aid: "Endpoint" });
    await expect(page.getByTestId("held-target")).toContainText("Endpoint");
    await releaseAt(page, beside, "Left");
  });

  test("Palette opens: a silent hold of the talking hand shows its reference ring after 600 ms, and a release in the centre cancels", async ({
    page,
  }) => {
    await start(page);
    await engage(page);
    const [x, y] = await openGround(page, 2000, 2000);
    const at = (await viewerOf(page, [x + 1000, y + 1000])) as Point;
    await holdAt(page, at, "Left");
    expect((await toolSnapshot(page)).palette).toMatchObject({
      ring: "reference",
      hand: "Left",
      hidden: true,
    });
    await expect(page.getByTestId("tool-palette")).toHaveCount(0);
    await expect(page.getByTestId("tool-palette")).toBeVisible();
    await expect(page.getByTestId("tool-palette")).toHaveAttribute("data-ring", "reference");
    await releaseAt(page, at, "Left");
    await expect(page.getByTestId("tool-palette")).toHaveCount(0);
    await expect(page.getByTestId("active-tool")).toHaveAttribute("data-tool", "select");
    await expect(mic(page)).toHaveAttribute("data-state", "off");
  });

  test("The left hand opens the reference ring: a silent flick up picks Sketch line", async ({ page }) => {
    await start(page);
    await engage(page);
    const [x, y] = await openGround(page, 2000, 2000);
    const at = (await viewerOf(page, [x + 1000, y + 1000])) as Point;
    await holdAt(page, at, "Left");
    await handEvent(page, "Left", "pinch.drag.update", [at[0], at[1] - 0.15]);
    await expect(page.getByTestId("tool-palette")).toHaveAttribute("data-ring", "reference");
    await expect(page.getByTestId("palette-slot-0")).toHaveAttribute("data-highlighted", "true");
    await releaseAt(page, [at[0], at[1] - 0.15], "Left");
    await expect(page.getByTestId("active-tool")).toHaveAttribute("data-tool", "sketch-line");
  });

  test("Left-handed user: with Dominant hand Left, the left hand's silent hold shows the action ring", async ({
    page,
  }) => {
    await start(page);
    await openSettings(page, "rings");
    await page.getByTestId("dominant-hand-left").click();
    await closeSettings(page);
    await engage(page);
    const [x, y] = await openGround(page, 2000, 2000);
    const at = (await viewerOf(page, [x + 1000, y + 1000])) as Point;
    await holdAt(page, at, "Left");
    await expect(page.getByTestId("tool-palette")).toHaveAttribute("data-ring", "action");
    await expect(page.getByTestId("tool-palette")).toHaveAttribute("data-hand", "left");
    await releaseAt(page, at, "Left");
  });

  test("The dominant hand opens its ring at once: the right hand's long pinch shows the action ring, no microphone", async ({
    page,
  }) => {
    await start(page);
    await engage(page);
    const [x, y] = await openGround(page, 2000, 2000);
    const at = (await viewerOf(page, [x + 1000, y + 1000])) as Point;
    await pointAt(page, at);
    await holdAt(page, at);
    await expect(page.getByTestId("tool-palette")).toBeVisible();
    await expect(page.getByTestId("tool-palette")).toHaveAttribute("data-ring", "action");
    expect((await toolSnapshot(page)).palette?.hidden).toBe(false);
    await page.waitForTimeout(500);
    await expect(mic(page)).toHaveAttribute("data-state", "off");
    await expect(page.getByTestId("hand-pointer-right")).not.toHaveAttribute("data-mode", "talk");
    await releaseAt(page, at);
  });

  test("A binding opens a ring at once: with the left hand's long pinch set to the action ring, no microphone", async ({
    page,
  }) => {
    await start(page);
    await openSettings(page, "gestures");
    await page.getByTestId("gesture-hold-left").selectOption("action-ring");
    await closeSettings(page);
    await engage(page);
    const [x, y] = await openGround(page, 2000, 2000);
    const at = (await viewerOf(page, [x + 1000, y + 1000])) as Point;
    await holdAt(page, at, "Left");
    await expect(page.getByTestId("tool-palette")).toBeVisible();
    expect((await toolSnapshot(page)).palette?.hidden).toBe(false);
    await expect(mic(page)).toHaveAttribute("data-state", "off");
    await releaseAt(page, at, "Left");
  });

  test("Hold on a control presses it: a long pinch on Undo undoes, and the microphone stays off", async ({
    page,
  }) => {
    await start(page);
    await engage(page);
    await page.evaluate(() =>
      window.__HAI_SCENE__?.apply("Rename", [{ op: "update", id: "block-c", patch: { name: "Renamed" } }]),
    );
    await expect.poll(() => bridge?.scene.scene.doc.elements["block-c"]?.name).toBe("Renamed");
    const box = await page.getByRole("button", { name: "Undo", exact: true }).first().boundingBox();
    const viewer = await page.getByTestId("viewer").boundingBox();
    if (!box || !viewer) throw new Error("not laid out");
    const at: Point = [
      (box.x + box.width / 2 - viewer.x) / viewer.width,
      (box.y + box.height / 2 - viewer.y) / viewer.height,
    ];
    await pointAt(page, at, "Left");
    await holdAt(page, at, "Left");
    await releaseAt(page, at, "Left");
    await expect.poll(() => bridge?.scene.scene.doc.elements["block-c"]?.name).toBe("Block C pavilion");
    await expect(mic(page)).toHaveAttribute("data-state", "off");
  });

  test("the pinch on its way to a long pinch fills a ring around the pointer, which goes when the hand moves", async ({
    page,
  }) => {
    await start(page);
    await engage(page);
    const [x, y] = await openGround(page, 2000, 2000);
    const at = (await viewerOf(page, [x + 1000, y + 1000])) as Point;
    const hand = await page.evaluate(([vx, vy]) => window.__HAI_VIEWER__?.handAt(vx, vy), at);
    // Tracking sends the pointer every frame while the fingers close.
    const frames = async (ms: number, p = hand) => {
      for (let t = 0; t < ms; t += 33) {
        await page.evaluate(
          (q) => window.__HAI_INPUT__?.pointer(q as [number, number], null, { Right: true }),
          p,
        );
        await page.waitForTimeout(33);
      }
    };
    await frames(400);
    const progress = page.getByTestId("hold-progress-right");
    await expect(progress).toBeVisible();
    await frames(200, hand ? [hand[0] + 0.1, hand[1]] : hand);
    await expect(progress).toHaveCount(0);
  });

  test("Counts update and Counts stay local: holds are counted here, and nothing leaves the machine", async ({
    page,
  }) => {
    await start(page);
    await engage(page);
    const hosts = new Set<string>();
    page.on("request", (request) => hosts.add(new URL(request.url()).hostname));
    page.on("websocket", (ws) => hosts.add(new URL(ws.url()).hostname));
    const [x, y] = await openGround(page, 2000, 2000);
    const at = (await viewerOf(page, [x + 1000, y + 1000])) as Point;
    await holdAt(page, at, "Left");
    await releaseAt(page, at, "Left");
    await holdAt(page, at, "Left");
    await releaseAt(page, [at[0], at[1] - 0.15], "Left");
    const counts = await page.evaluate(
      () =>
        (
          window as unknown as {
            __HAI_CAMERA__?: { detection: { getSnapshot(): { holds: Record<string, number> } } };
          }
        ).__HAI_CAMERA__?.detection.getSnapshot().holds,
    );
    expect(counts).toEqual({ held: 2, spoke: 0, action: 0, reference: 1, cancelled: 1 });
    // The Detection card shows them; nothing about them (or anything else) went beyond this machine.
    await openSettings(page, "camera");
    await expect(page.getByTestId("detect-holds")).toHaveCount(1);
    expect([...hosts].filter((h) => h !== "127.0.0.1" && h !== "localhost")).toEqual([]);
  });
});

test.describe("listening while held", () => {
  test("Release ends listening: the microphone is live within 150 ms of the hold (detector preloaded at engagement), and off within 100 ms of letting go", async ({
    page,
  }) => {
    await start(page);
    await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
    await page.waitForTimeout(4000); // the speech detector loads at the first engagement
    const [x, y] = await openGround(page, 2000, 2000);
    const at = (await viewerOf(page, [x + 1000, y + 1000])) as Point;
    const position = await page.evaluate(([vx, vy]) => window.__HAI_VIEWER__?.handAt(vx, vy), at);
    await page.evaluate((p) => window.__HAI_INPUT__?.pointer(null, p as Point), position);
    // Times measured in the page: when the hold fired, when the chip said it listens, when the mic went off.
    await page.evaluate(() => {
      const marks: Record<string, number> = {};
      (window as unknown as { __HOLD__: typeof marks }).__HOLD__ = marks;
      new MutationObserver(() => {
        const chip = document.querySelector("[data-testid=held-chip]")?.textContent ?? "";
        if (marks.live === undefined && chip.startsWith("Listening")) marks.live = performance.now();
        const mic = document.querySelector("[data-testid=mic-indicator]")?.getAttribute("data-state");
        if (marks.released !== undefined && marks.off === undefined && mic === "off")
          marks.off = performance.now();
      }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    });
    // A first hold opens the microphone and builds the audio graph once; the one measured is the next.
    await holdAt(page, at, "Left");
    await expect(page.getByTestId("held-chip")).toContainText("Listening");
    await releaseAt(page, at, "Left");
    await expect(page.getByTestId("mic-indicator")).toHaveAttribute("data-state", "off");
    // Hold again, marking the moment the hold fires in the same step that sends it.
    const fired = await page.evaluate((p) => {
      const marks = (window as unknown as { __HOLD__: Record<string, number> }).__HOLD__;
      for (const key of Object.keys(marks)) delete marks[key];
      const now = performance.now();
      const at = { hand: "Left", position: p, delta: [0, 0], confidence: 1, ts: now };
      window.__HAI_INPUT__?.gestures([
        { type: "pinch.drag.start", ...at },
        { type: "pinch.hold", ...at },
      ]);
      return now;
    }, position);
    await expect(page.getByTestId("held-chip")).toContainText("Listening");
    // Let go, marking the moment in the same step that sends it (round trips from the test are not the app's).
    await page.evaluate((p) => {
      (window as unknown as { __HOLD__: Record<string, number> }).__HOLD__.released = performance.now();
      window.__HAI_INPUT__?.gestures([
        {
          type: "pinch.drag.end",
          hand: "Left",
          position: p,
          delta: [0, 0],
          confidence: 1,
          ts: performance.now(),
        },
      ]);
    }, position);
    await expect(page.getByTestId("mic-indicator")).toHaveAttribute("data-state", "off");
    const marks = await page.evaluate(
      () => (window as unknown as { __HOLD__: Record<string, number> }).__HOLD__,
    );
    const live = Math.round((marks.live ?? Number.NaN) - fired);
    const off = Math.round((marks.off ?? Number.NaN) - (marks.released ?? Number.NaN));
    console.log(`hold: microphone live after ${live} ms, off ${off} ms after letting go`);
    // The budgets are for the reference laptop; CPU-only CI runners are slower.
    if (!process.env.CI) {
      expect(live).toBeLessThanOrEqual(150);
      expect(off).toBeLessThanOrEqual(100);
    }
  });
});
