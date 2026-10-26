// Records demo 17 (demos/17-workers.md) against the real, signed-in Claude Code CLI, so it is manual: CI and a plain
// `pnpm test:e2e` skip it. Run it with
//   HAI_LIVE_CLAUDE=1 pnpm exec playwright test e2e/workers-demo.spec.ts
// The browser is recorded at 1080p with burned-in captions; the video lands in test-results next to a report of what
// the agents really did (the real-run checklist of the demo). There are no hands and no voice: the requests are typed.
import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Team } from "../apps/bridge/src/agent/team.ts";
import { ClaudeCliProvider } from "../packages/agent-core/src/index.ts";
import { openViewer, startTestBridge } from "./viewer.ts";

const live = process.env.HAI_LIVE_CLAUDE === "1";
test.skip(!live, "manual: needs the signed-in Claude Code CLI (HAI_LIVE_CLAUDE=1)");

test.use({
  viewport: { width: 1920, height: 1080 },
  video: { mode: "on", size: { width: 1920, height: 1080 } },
});

const ENDED = ["done", "failed", "stopped"];

test("demo 17: a plan, workers nested under Architect, and Stop ending all of them", async ({
  page,
}, testInfo) => {
  test.setTimeout(1_500_000);
  const bridge = await startTestBridge(page, { agent: new ClaudeCliProvider() });
  const team = bridge.agent as Team;
  const timeline: { t: number; sessions: number; running: string[] }[] = [];
  const facts: Record<string, unknown> = {};
  const t0 = Date.now();
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
  const sample = () =>
    timeline.push({
      t: Math.round((Date.now() - t0) / 100) / 10,
      sessions: team.sessions,
      running: team.board.filter((t) => t.status === "running").map((t) => t.agent),
    });
  const allow = page.getByRole("button", { name: "Allow", exact: true });
  const until = async (done: () => boolean | Promise<boolean>, ms: number) => {
    const started = Date.now();
    while (Date.now() - started < ms) {
      if (await done()) return true;
      if (await allow.first().isVisible()) await allow.first().click();
      sample();
      await page.waitForTimeout(1_000);
    }
    return false;
  };
  const settled = () => team.board.length > 0 && team.board.every((t) => ENDED.includes(t.status));

  try {
    await openViewer(page);
    await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
    await expect(page.getByTestId("agent-status")).toHaveAttribute("data-state", "idle", { timeout: 60_000 });
    mkdirSync(testInfo.outputDir, { recursive: true });

    // 1. The request, and Mochi's plan.
    await caption("Mochi shows me the split before anything starts");
    await page.waitForTimeout(1_500);
    await page
      .getByTestId("agent-input")
      .fill(
        "Mochi, build a garden pavilion with three tasks and show me the plan first with confirm_plan: one Architect task for the pavilion itself (Architect makes its hall and its pergola with workers, spawn_worker), one for a low boundary wall around it, and one for a pond.",
      );
    await page.getByTestId("agent-input").press("Enter");
    const plan = page.getByTestId("plan-card");
    facts.planCardShown = await until(() => plan.isVisible(), 240_000);

    // 2. Remove a part and confirm.
    if (facts.planCardShown) {
      await page.screenshot({ path: testInfo.outputPath("plan.png") });
      await page.waitForTimeout(3_000);
      await caption("I take out a part. Nothing starts until I confirm");
      const parts = page.getByTestId("plan-part");
      facts.planParts = await parts.allInnerTexts();
      const pond = parts.filter({ hasText: /pond|water/i });
      const target = (await pond.count()) > 0 ? pond.first() : parts.last();
      await target.getByTestId("plan-part-remove").click();
      await page.waitForTimeout(2_500);
      await page.getByTestId("plan-confirm").click();
    }

    // 3-4. The parts are made, workers nested under their specialist.
    await caption("Architect splits its own task. Each part is its own session");
    await until(() => team.board.some((t) => t.kind === "worker") || settled(), 600_000);
    facts.workersAppeared = team.board.some((t) => t.kind === "worker");
    if (facts.workersAppeared) {
      await page.waitForTimeout(2_000);
      await page.screenshot({ path: testInfo.outputPath("workers.png") });
      await caption("Two hands working at once");
    }
    facts.firstRunSettled = await until(settled, 600_000);
    await caption("Done: every part has its owner and its colour");
    await page.waitForTimeout(3_000);
    await page.screenshot({ path: testInfo.outputPath("done.png") });
    const firstBoard = team.board.map((t) => ({
      agent: t.agent,
      kind: t.kind ?? "task",
      parent: t.parent,
      title: t.title,
      scope: t.scope ?? "(whole model)",
      status: t.status,
      startedAt: t.startedAt,
      finishedAt: t.finishedAt,
    }));
    const workers = team.board.filter((t) => t.kind === "worker" && t.startedAt && t.finishedAt);
    facts.workersOverlapped = workers.some((a) =>
      workers.some(
        (b) =>
          a !== b && (a.startedAt ?? 0) < (b.finishedAt ?? 0) && (b.startedAt ?? 0) < (a.finishedAt ?? 0),
      ),
    );
    facts.peakSessions = Math.max(0, ...timeline.map((s) => s.sessions));
    facts.sessionLimit = team.maxSessions;
    facts.firstBoard = firstBoard;

    // 6. A second run, stopped while its workers are running.
    await caption("Stop ends all of them");
    await page.waitForTimeout(1_500);
    await page
      .getByTestId("agent-input")
      .fill(
        "Architect, add a gate house next to the pavilion in two separate parts, and use workers (spawn_worker) so the two parts are made at the same time: the walls and the roof.",
      );
    await page.getByTestId("agent-input").press("Enter");
    const running = await until(
      () => team.board.some((t) => t.kind === "worker" && t.status === "running"),
      300_000,
    );
    facts.secondRunWorkersRunning = running;
    if (running) {
      await page.waitForTimeout(4_000);
      const stop = page.getByTestId("team-stop");
      const stopAt = Date.now();
      await stop.click();
      facts.stopAllEndedEverything = await until(settled, 20_000);
      facts.stopAllSeconds = (Date.now() - stopAt) / 1000;
    }
    await page.waitForTimeout(2_500);
    await page.screenshot({ path: testInfo.outputPath("stopped.png") });
    const claimsLeft = team.claims.all.length;
    facts.claimsLeftAfterStop = claimsLeft;

    const report = { facts, timeline };
    console.log(`DEMO 17: ${JSON.stringify(facts, null, 2)}`);
    writeFileSync(testInfo.outputPath("report.json"), JSON.stringify(report, null, 2));
    expect(team.board.length).toBeGreaterThan(0);
  } finally {
    await bridge.stop();
  }
});
