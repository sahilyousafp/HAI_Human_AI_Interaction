import { expect, test } from "@playwright/test";
import { frame, offerCard, sceneOf, shell, start, stopBridge, team } from "./panel-support.ts";

// Every agent can offer a panel; the panel of an agent that does not change the model is information only.

test.afterEach(stopBridge);

const STATUS = `<h2>Status</h2><p id="x">All quiet</p>`;

/** A panel whose script tries to move a column and keep it: what an information panel must not be able to do. */
const TRIES_TO_CHANGE = `<h2>Numbers</h2><p id="p">waiting</p>
<script>
  hai.on("problem", (m) => { document.getElementById("p").textContent = m; });
  hai.scene.get({ ids: ["col-a1"] }).then(({ elements }) => {
    const c = elements[0];
    hai.preview([{ op: "update", id: c.id, patch: { position: [c.position[0] + 500, c.position[1]] } }]);
    hai.commit();
  });
</script>`;

test("Mochi opens an information panel of its own: it shows, has Close only, and changes nothing", async ({
  page,
}, testInfo) => {
  await start(page);
  const before = await sceneOf(page);
  void team().request(`panel ${STATUS}`);
  await expect(offerCard(page)).toBeVisible();
  await expect(page.getByTestId("offer-agent").last()).toHaveText("Mochi");
  await page.getByTestId("offer-open").click();
  await expect(frame(page).locator("#x")).toHaveText("All quiet");
  await expect(shell(page).getByTestId("panel-agent")).toHaveText("Mochi");
  await expect(shell(page).getByTestId("panel-close")).toBeVisible();
  await expect(shell(page).getByTestId("panel-done")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("mochi-info-panel.png") });
  await shell(page).getByTestId("panel-close").click();
  await expect(shell(page)).toHaveCount(0);
  expect(await sceneOf(page)).toEqual(before);
});

test("a reader's panel that tries to preview and commit is refused, and the model does not move", async ({
  page,
}) => {
  await start(page);
  const before = await sceneOf(page);
  await team().request(`delegate climate: panel ${TRIES_TO_CHANGE}`);
  await expect(offerCard(page)).toBeVisible();
  await expect(page.getByTestId("offer-agent").last()).toHaveText("Climate");
  await page.getByTestId("offer-open").click();
  await expect(frame(page).locator("#p")).toContainText("information only");
  await expect(shell(page).getByTestId("panel-done")).toHaveCount(0);
  expect(await sceneOf(page)).toEqual(before);
  // Nothing was previewed either: the viewer shows the committed scene.
  const shown = await page.evaluate(() => {
    const doc = window.__HAI_SCENE__?.getSnapshot().doc ?? null;
    const column = window.__HAI_PANELS__?.shownDoc(doc)?.elements["col-a1"];
    return column?.type === "column" ? column.position : null;
  });
  const committed = before["col-a1"];
  expect(shown).toEqual(committed?.type === "column" ? committed.position : null);
  await shell(page).getByTestId("panel-close").click();
  await team().settled();
});

test("a writer's panel keeps its sliders: Architect previews and Done keeps one undo step", async ({
  page,
}) => {
  await start(page);
  const before = await sceneOf(page);
  await team().request("delegate architect: panel");
  await expect(offerCard(page)).toBeVisible();
  await page.getByTestId("offer-open").click();
  await expect(frame(page).locator("#s")).toBeVisible();
  await expect(shell(page).getByTestId("panel-done")).toBeVisible();
  await frame(page).locator("#s").fill("250");
  await shell(page).getByTestId("panel-done").click();
  await expect.poll(async () => JSON.stringify(await sceneOf(page))).not.toEqual(JSON.stringify(before));
  await team().settled();
});
