// Records demo 18 (demos/18-agent-eyes.md) against the real, signed-in Claude Code CLI, so it is manual. Run it with
//   HAI_LIVE_CLAUDE=1 pnpm exec playwright test e2e/agent-eyes-demo.spec.ts
// Architect builds a pavilion and checks it from its own cameras; the browser is recorded at 1080p with captions, and the
// report says what happened (add-agent-cameras 5.2).
import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { ask, ENDED, start, until } from "./live-support.ts";

const live = process.env.HAI_LIVE_CLAUDE === "1";
test.skip(!live, "manual: needs the signed-in Claude Code CLI (HAI_LIVE_CLAUDE=1)");

test.use({
  viewport: { width: 1920, height: 1080 },
  video: { mode: "on", size: { width: 1920, height: 1080 } },
});

test("5.2: Architect checks its pavilion from its own cameras while the user's view stays put", async ({
  page,
}, testInfo) => {
  test.setTimeout(900_000);
  const { bridge, team } = await start(page);
  mkdirSync(testInfo.outputDir, { recursive: true });
  const caption = (text: string) =>
    page.evaluate((text) => {
      let el = document.getElementById("demo-caption");
      if (!el) {
        el = document.createElement("div");
        el.id = "demo-caption";
        el.style.cssText =
          "position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:99999;max-width:70%;padding:10px 22px;border-radius:12px;background:rgba(20,20,24,.82);color:#fff;font:600 24px system-ui,sans-serif;text-align:center;pointer-events:none";
        document.body.append(el);
      }
      el.textContent = text;
    }, text);
  try {
    const camera = () => page.evaluate(() => JSON.stringify(window.__HAI_VIEWER__?.camera()));
    const cameraBefore = await camera();
    const t0 = Date.now();
    let firstShotAfter: number | null = null;
    const names = new Set<string>();
    await caption("One request");
    await page.waitForTimeout(1_500);
    await ask(page, "Mochi, build a small pavilion: six columns and a slab roof, on the empty ground.");
    await caption("I keep my own view");
    const shots = page.getByTestId("team-shots");
    const ended = await until(
      page,
      () => team.board.length > 0 && team.board.every((t) => ENDED.includes(t.status)),
      700_000,
      async () => {
        for (const thumb of await shots.locator('[data-testid^="team-shot-"]').all()) {
          const label = (await thumb.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
          if (label) names.add(label);
        }
        if (names.size > 0 && firstShotAfter === null) {
          firstShotAfter = Math.round((Date.now() - t0) / 1000);
          await caption("Architect looks from cameras of its own");
        }
      },
    );
    await page.waitForTimeout(1_500);
    await page.screenshot({ path: testInfo.outputPath("thumbnails.png") });
    const thumb = shots.locator('[data-testid^="team-shot-"]').first();
    let dialog = false;
    if (await thumb.isVisible()) {
      await caption("Click a thumbnail: the picture opens larger");
      await thumb.click();
      dialog = await page.getByTestId("shot-dialog").isVisible();
      await page.waitForTimeout(3_000);
      await page.screenshot({ path: testInfo.outputPath("dialog.png") });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(800);
    }
    const cameraAfter = await camera();
    const report = {
      ended,
      firstPictureAfterSeconds: firstShotAfter,
      thumbnails: [...names],
      dialogOpened: dialog,
      userCameraUnchanged: cameraBefore === cameraAfter,
      elements: Object.keys(bridge.scene.scene.doc.elements).length,
      summaries: team.board.map((t) => ({ agent: t.agent, summary: t.summary })),
    };
    console.log(`LIVE cameras: ${JSON.stringify(report, null, 2)}`);
    writeFileSync(testInfo.outputPath("cameras.json"), JSON.stringify(report, null, 2));
    expect(team.board.length).toBeGreaterThan(0);
  } finally {
    await bridge.stop();
  }
});
