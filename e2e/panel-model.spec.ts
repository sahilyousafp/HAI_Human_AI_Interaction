import { expect, test } from "@playwright/test";
import {
  askForPanel,
  callTool,
  committedColumnX,
  current,
  frame,
  offerCard,
  openClearancePanel,
  openCustomPanel,
  shell,
  shownColumnX,
  start,
  stopBridge,
  team,
} from "./panel-support.ts";

// A panel's controls change the model live, in the viewer only. Done keeps the result as one undo step, and Close
// puts the model back. The default panel is a clearance slider that previews moving column col-a1 (at x = 4000 mm).

test.afterEach(stopBridge);

const COLUMN = 4000;

/** Moves the clearance slider to a value, retrying until the panel has read the column it moves. */
async function slideTo(page: import("@playwright/test").Page, clearance: number, expectedX: number) {
  await expect
    .poll(async () => {
      await frame(page).locator("#s").fill(String(clearance));
      return shownColumnX(page);
    })
    .toBe(expectedX);
}

const canUndo = (page: import("@playwright/test").Page) =>
  page.evaluate(() => window.__HAI_SCENE__?.getSnapshot().canUndo);
const lastLabel = (page: import("@playwright/test").Page) =>
  page.evaluate(() => window.__HAI_SCENE__?.getSnapshot().lastChange?.label);

test.describe("live preview", () => {
  test("Slider moves the column live: the viewer shows it while the bridge still holds the original", async ({
    page,
  }) => {
    await start(page);
    await openClearancePanel(page);
    await slideTo(page, 200, COLUMN + 50);
    expect(committedColumnX()).toBe(COLUMN);
    expect(await canUndo(page)).toBe(false);
    await expect(frame(page).locator("#v")).toHaveText("200");
  });

  test("a control moves the model within one frame and one message hop (under 50 ms)", async ({ page }) => {
    await start(page);
    await openClearancePanel(page);
    await slideTo(page, 150, COLUMN);
    const samples: number[] = [];
    for (const value of [160, 190, 220, 250, 280, 310, 340, 300, 260, 220]) {
      // Time from the control's input event (in the frame) to the viewer drawing the new position.
      const sentAt = frame(page)
        .locator("#s")
        .evaluate((el, v) => {
          const t0 = performance.timeOrigin + performance.now();
          (el as HTMLInputElement).value = String(v);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          return t0;
        }, value);
      const seen = page.evaluate(
        (target) =>
          new Promise<number>((resolve) => {
            const check = () => {
              const doc = window.__HAI_SCENE__?.getSnapshot().doc ?? null;
              const column = window.__HAI_PANELS__?.shownDoc(doc)?.elements["col-a1"];
              if (column?.type === "column" && column.position?.[0] === target)
                resolve(performance.timeOrigin + performance.now());
              else requestAnimationFrame(check);
            };
            check();
          }),
        COLUMN + value - 150,
      );
      const [t0, t1] = await Promise.all([sentAt, seen]);
      samples.push(t1 - t0);
    }
    samples.sort((a, b) => a - b);
    expect(samples[Math.floor(samples.length / 2)]).toBeLessThan(50);
  });

  test("Agent does not see previews: it reads the committed position", async ({ page }) => {
    await start(page);
    await openClearancePanel(page);
    await slideTo(page, 250, COLUMN + 100);
    const read = await callTool("get_elements", { ids: ["col-a1"] });
    expect(read.elements[0].position).toEqual([COLUMN, 4000]);
  });

  test("Preview leaves no history: undo goes to the last committed change, not to a preview", async ({
    page,
  }) => {
    await start(page);
    await page.evaluate(() =>
      window.__HAI_SCENE__?.apply("Taller wall", [{ op: "update", id: "wall-n", patch: { height: 3800 } }]),
    );
    await expect.poll(() => canUndo(page)).toBe(true);
    await openClearancePanel(page);
    for (const [value, x] of [
      [180, COLUMN + 30],
      [220, COLUMN + 70],
      [260, COLUMN + 110],
    ] as const)
      await slideTo(page, value, x);
    await page.evaluate(() => window.__HAI_SCENE__?.undo());
    // The committed change was undone; the preview is still laid over the scene.
    await expect
      .poll(() => {
        const wall = current().scene.scene.doc.elements["wall-n"];
        return wall?.type === "wall" ? wall.height : null;
      })
      .toBe(3500);
    expect(await shownColumnX(page)).toBe(COLUMN + 110);
    expect(await canUndo(page)).toBe(false);
  });
});

test.describe("Done and Close", () => {
  test("Done commits once: two changes arrive as one transaction labelled with the title, and one undo reverts both", async ({
    page,
  }) => {
    await start(page);
    await openCustomPanel(
      page,
      `<button id="go" type="button">Go</button><script>
        document.getElementById("go").addEventListener("click", () => hai.preview([
          { op: "update", id: "col-a1", patch: { position: [4400, 4000] } },
          { op: "update", id: "wall-n", patch: { height: 2800 } },
        ]));
      </script>`,
    );
    await frame(page).locator("#go").click();
    await expect.poll(() => shownColumnX(page)).toBe(4400);
    await shell(page).getByTestId("panel-done").click();
    await expect(shell(page)).toHaveCount(0);
    await expect.poll(() => committedColumnX()).toBe(4400);
    const wall = current().scene.scene.doc.elements["wall-n"];
    expect(wall?.type === "wall" && wall.height).toBe(2800);
    expect(await lastLabel(page)).toBe("Clearance");
    // Exactly one undo step: one undo reverts both, and nothing more can be undone.
    await page.evaluate(() => window.__HAI_SCENE__?.undo());
    await expect.poll(() => committedColumnX()).toBe(COLUMN);
    const restored = current().scene.scene.doc.elements["wall-n"];
    expect(restored?.type === "wall" && restored.height).not.toBe(2800);
    expect(await canUndo(page)).toBe(false);
  });

  test("Close discards: the column is back, and no undo step was added", async ({ page }) => {
    await start(page);
    await openClearancePanel(page);
    await slideTo(page, 300, COLUMN + 150);
    await shell(page).getByTestId("panel-close").click();
    await expect(shell(page)).toHaveCount(0);
    expect(await shownColumnX(page)).toBe(COLUMN);
    expect(committedColumnX()).toBe(COLUMN);
    expect(await canUndo(page)).toBe(false);
  });

  test("Commit from the panel twice: it stays open and two undo steps exist", async ({ page }) => {
    await start(page);
    await openClearancePanel(page);
    await slideTo(page, 200, COLUMN + 50);
    await frame(page).locator("#apply").click();
    await expect.poll(() => committedColumnX()).toBe(COLUMN + 50);
    await slideTo(page, 250, COLUMN + 100);
    await frame(page).locator("#apply").click();
    await expect.poll(() => committedColumnX()).toBe(COLUMN + 100);
    await expect(shell(page)).toBeVisible();
    await page.evaluate(() => window.__HAI_SCENE__?.undo());
    await expect.poll(() => committedColumnX()).toBe(COLUMN + 50);
    await page.evaluate(() => window.__HAI_SCENE__?.undo());
    await expect.poll(() => committedColumnX()).toBe(COLUMN);
  });

  test("the agent is told once, after Done and after Close", async ({ page }) => {
    await start(page);
    await openClearancePanel(page);
    await slideTo(page, 200, COLUMN + 50);
    await shell(page).getByTestId("panel-done").click();
    const notes = () =>
      team()
        .hub("architect")
        .greet((message) => {
          if (message.type === "agent.transcript") seen.push(...message.payload.turns.map((t) => t.request));
        });
    const seen: string[] = [];
    await expect
      .poll(() => {
        seen.length = 0;
        notes();
        return seen.filter((r) => r.startsWith("[panel]"));
      })
      .toHaveLength(1);
    expect(seen.find((r) => r.startsWith("[panel]"))).toContain("kept the result");
  });
});

test.describe("replacing, closing and stopping", () => {
  test("Replace discards preview: the column is back and the new document shows", async ({ page }) => {
    await start(page);
    await openClearancePanel(page);
    await slideTo(page, 250, COLUMN + 100);
    await team().request('delegate architect: panel update <p id="fresh">A new panel</p>');
    await expect(frame(page).locator("#fresh")).toHaveText("A new panel");
    expect(await shownColumnX(page)).toBe(COLUMN);
  });

  test("Agent closes the panel: it goes, and the uncommitted preview with it", async ({ page }) => {
    await start(page);
    await openClearancePanel(page);
    await slideTo(page, 250, COLUMN + 100);
    await team().request("delegate architect: panel close");
    await expect(shell(page)).toHaveCount(0);
    expect(await shownColumnX(page)).toBe(COLUMN);
  });

  test("Stop does not close the panel: the turn stops, and Done still commits the preview", async ({
    page,
  }) => {
    await start(page);
    await askForPanel("stay");
    await expect(offerCard(page)).toBeVisible();
    await page.getByTestId("offer-open").click();
    await expect(frame(page).locator("#s")).toBeVisible();
    await expect(page.getByTestId("team-stop")).toBeVisible(); // the agent is still working
    await slideTo(page, 200, COLUMN + 50);
    await page.getByTestId("team-stop").click();
    await expect(page.getByTestId("team-stop")).toHaveCount(0);
    await expect(shell(page)).toBeVisible();
    await shell(page).getByTestId("panel-done").click();
    await expect.poll(() => committedColumnX()).toBe(COLUMN + 50);
  });
});

test.describe("reading the scene", () => {
  test("Panel reads the scene: it receives the columns with their ids and properties", async ({ page }) => {
    await start(page);
    await openCustomPanel(
      page,
      `<p id="ids">none</p><script>
        hai.scene.get({ type: "column" }).then(({ elements }) => {
          document.getElementById("ids").textContent = elements.map((e) => e.id + ":" + e.position.join(",")).join(" ");
        });
      </script>`,
    );
    await expect(frame(page).locator("#ids")).toContainText("col-a1:4000,4000");
    await expect(frame(page).locator("#ids")).toContainText("col-c3:20000,16000");
  });

  test("events arrive after a scene patch and after a selection change", async ({ page }) => {
    await start(page);
    await openCustomPanel(
      page,
      `<p id="log">start</p><script>
        const log = [];
        const show = () => { document.getElementById("log").textContent = log.join(" "); };
        hai.on("selection", (ids) => { log.push("selection:" + ids.join(",")); show(); });
        hai.on("scene", () => { log.push("scene"); show(); });
      </script>`,
    );
    await page.evaluate(() => window.__HAI_SCENE__?.select(["col-b2"]));
    await expect(frame(page).locator("#log")).toContainText("selection:col-b2");
    await page.evaluate(() =>
      window.__HAI_SCENE__?.apply("Taller wall", [{ op: "update", id: "wall-n", patch: { height: 3300 } }]),
    );
    await expect(frame(page).locator("#log")).toContainText("scene");
  });
});

test.describe("losing the connection", () => {
  test("Connection lost: the panel closes and the column shows its committed position", async ({ page }) => {
    await start(page);
    await openClearancePanel(page);
    await slideTo(page, 250, COLUMN + 100);
    await current().stop();
    await expect(shell(page)).toHaveCount(0);
    expect(await shownColumnX(page)).toBe(COLUMN);
  });
});
