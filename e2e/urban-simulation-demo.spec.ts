// Records demo 19 (demos/19-urban-and-simulation.md) against the real, signed-in Claude Code CLI and the real open-data
// servers, so it is manual. Run it with
//   HAI_LIVE_CLAUDE=1 pnpm exec playwright test e2e/urban-simulation-demo.spec.ts
// The site is proposed and allowed, Urban fetches the neighbours and the green cover, Climate reads the weather,
// Simulation reads the ground's temperature, and Mochi puts what was found on an information panel. The browser is
// recorded at 1080p with captions, and the report says what happened (add-urban-simulation-agents 8.3).
import { mkdirSync, writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import type { Team } from "../apps/bridge/src/agent/team.ts";
import { ClaudeCliProvider } from "../packages/agent-core/src/index.ts";
import { ask, ENDED, until } from "./live-support.ts";
import { closeSettings, openSettings } from "./settings.ts";
import { openViewer, startTestBridge } from "./viewer.ts";

const live = process.env.HAI_LIVE_CLAUDE === "1";
test.skip(!live, "manual: needs the signed-in Claude Code CLI and the internet (HAI_LIVE_CLAUDE=1)");

test.use({
  viewport: { width: 1920, height: 1080 },
  video: { mode: "on", size: { width: 1920, height: 1080 } },
});

const caption = (page: Page, text: string) =>
  page.evaluate((text) => {
    let el = document.getElementById("demo-caption");
    if (!el) {
      el = document.createElement("div");
      el.id = "demo-caption";
      el.style.cssText =
        "position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:99999;max-width:70%;padding:10px 22px;border-radius:12px;background:rgba(20,20,24,.82);color:#fff;font:600 24px system-ui,sans-serif;text-align:center";
      document.body.append(el);
    }
    el.textContent = text;
  }, text);

test("8.3: the site talks back: neighbours, weather, ground temperature and an information panel", async ({
  page,
}, testInfo) => {
  test.setTimeout(1_800_000);
  const bridge = await startTestBridge(page, { agent: new ClaudeCliProvider() });
  const team = bridge.agent as Team;
  mkdirSync(testInfo.outputDir, { recursive: true });
  try {
    await openViewer(page);
    await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
    await expect(page.getByTestId("agent-status")).toHaveAttribute("data-state", "idle", { timeout: 60_000 });
    await openSettings(page, "open-data");
    await page.getByTestId("open-data-switch").click();
    await expect(page.getByTestId("open-data-switch")).toHaveAttribute("aria-checked", "true");
    await page.waitForTimeout(1_500);
    await page.screenshot({ path: testInfo.outputPath("0-settings.png") });
    await closeSettings(page);
    await expect(page.getByTestId("agent-status")).toHaveAttribute("data-state", "idle", { timeout: 60_000 });

    const started = Date.now();
    const seconds = () => Math.round((Date.now() - started) / 1000);
    const steps: Array<{ at: number; caption: string; request: string; seconds: number; ended: boolean }> =
      [];

    /** Asks one thing, allows any card (the site card is the one the demo wants to show), and waits for the team. */
    const step = async (words: string, request: string, shot: string, show?: () => Promise<void>) => {
      const at = seconds();
      await caption(page, words);
      await page.waitForTimeout(1_500);
      await ask(page, request);
      const first = Date.now();
      let carded = false;
      const ended = await until(
        page,
        async () => {
          const idle = (await page.getByTestId("agent-status").getAttribute("data-state")) === "idle";
          return idle && team.board.every((t) => ENDED.includes(t.status)) && Date.now() - first > 15_000;
        },
        600_000,
        async () => {
          // Show the approval card for a moment before it is allowed.
          if (!carded && (await page.getByTestId("approval-card").last().isVisible())) {
            carded = true;
            await page.screenshot({ path: testInfo.outputPath("1-site-card.png") });
            await page.waitForTimeout(2_500);
          }
          await show?.();
        },
      );
      await page.waitForTimeout(2_500);
      await page.screenshot({ path: testInfo.outputPath(shot) });
      steps.push({ at, caption: words, request, seconds: Math.round((Date.now() - first) / 1000), ended });
    };

    await step(
      "Tell Mochi where the project stands",
      "Mochi, the project stands in central Amsterdam, at latitude 52.3731 and longitude 4.8922. Save that as the site.",
      "1-site.png",
    );
    await step(
      "Urban reads the neighbours, in grey, beside the model",
      "Urban, fetch the buildings and trees within 150 m of the site and the green cover there, and tell me how many buildings there are and what share is green.",
      "2-urban.png",
    );
    await step(
      "Climate reads the weather, with its source and age",
      "Climate, what is the weather at the site right now? Say where it came from and how old it is.",
      "3-climate.png",
    );
    await step(
      "Simulation reads the ground, and says what it is",
      "Simulation, how warm is the ground around the site, how long ago was it measured, and how much shade do the neighbours put on the site at noon on 21 June?",
      "4-simulation.png",
    );

    // Mochi's information panel: opened with a nod, and it cannot change the model.
    const before = JSON.stringify(bridge.scene.scene.doc.elements);
    await caption(page, "Mochi shows what it found, on a panel that cannot change anything");
    await page.waitForTimeout(1_500);
    await ask(
      page,
      "Mochi, put a short summary of what we found about the site on a panel: the buildings, the weather and the ground temperature. Information only.",
    );
    const panelAt = Date.now();
    let panelAgent = "";
    let doneButtons = -1;
    const ended = await until(
      page,
      async () => {
        const idle = (await page.getByTestId("agent-status").getAttribute("data-state")) === "idle";
        return idle && doneButtons >= 0 && Date.now() - panelAt > 25_000;
      },
      420_000,
      async () => {
        const offer = page.getByTestId("offer-card").first();
        if (await offer.isVisible()) {
          await page.waitForTimeout(2_000);
          await page.evaluate(() =>
            window.__HAI_INPUT__?.gestures([{ type: "head.nod", ts: Date.now(), confidence: 1 }]),
          );
        }
        if (await page.getByTestId("panel-title").isVisible()) {
          await page.waitForTimeout(4_000);
          panelAgent = (await page.getByTestId("panel-agent").textContent()) ?? "";
          doneButtons = await page.getByTestId("panel-done").count();
          await page.screenshot({ path: testInfo.outputPath("5-panel.png") });
        }
      },
    );
    await page.waitForTimeout(3_000);
    const modelUnchanged = before === JSON.stringify(bridge.scene.scene.doc.elements);
    const hosts = [...new Set([...bridge.openData.record.entries].map((e) => e.host))].sort();
    const report = {
      steps,
      panel: { ended, agent: panelAgent, doneButtons, modelUnchanged },
      site: bridge.site.site,
      contextItems: bridge.context.items.length,
      hostsContacted: hosts,
      totalSeconds: seconds(),
      summaries: team.board.map((t) => ({ agent: t.agent, summary: t.summary })),
    };
    console.log(`LIVE demo 19: ${JSON.stringify(report, null, 2)}`);
    writeFileSync(testInfo.outputPath("demo-19.json"), JSON.stringify(report, null, 2));
    expect(steps.every((s) => s.ended)).toBe(true);
    expect(bridge.site.site).not.toBeNull();
    expect(modelUnchanged).toBe(true);
  } finally {
    await bridge.stop();
  }
});
