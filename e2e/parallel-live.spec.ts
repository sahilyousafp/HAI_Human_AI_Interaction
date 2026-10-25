// Runs against the real, signed-in Claude Code CLI, so it is manual: CI and a plain `pnpm test:e2e` skip it. Run it with
//   HAI_LIVE_CLAUDE=1 pnpm exec playwright test e2e/parallel-live.spec.ts
// The real lead is asked for a building in three separate parts. Does it split the request into scopes that do not
// overlap, with a brief, so that the specialists work at the same time? What it did is printed: the hand-offs with
// their scopes and brief, whether the tasks overlapped in time, who owns what, and any refusal an agent met.
import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Team } from "../apps/bridge/src/agent/team.ts";
import { ClaudeCliProvider } from "../packages/agent-core/src/index.ts";
import { openViewer, startTestBridge } from "./viewer.ts";

const live = process.env.HAI_LIVE_CLAUDE === "1";
test.skip(!live, "manual: needs the signed-in Claude Code CLI (HAI_LIVE_CLAUDE=1)");

test("the real lead splits a request into separate scopes with a brief, and the specialists work together", async ({
  page,
}, testInfo) => {
  test.setTimeout(900_000);
  const bridge = await startTestBridge(page, { agent: new ClaudeCliProvider() });
  const team = bridge.agent as Team;
  try {
    await openViewer(page);
    await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
    await expect(page.getByTestId("agent-status")).toHaveAttribute("data-state", "idle", { timeout: 60_000 });
    // Scene tools are pre-approved; this keeps the run from waiting on a card for anything else.
    mkdirSync(testInfo.outputDir, { recursive: true });
    await page
      .getByTestId("agent-input")
      .fill(
        "Build a small garden on the empty ground, three separate parts side by side: a hall (four columns and a slab roof, about 8 by 6 metres), a pergola (six columns in a row with a beam on top), and a pond (a low rim of four walls). Keep the three well apart.",
      );
    await page.getByTestId("agent-input").press("Enter");
    await expect.poll(() => team.board.length, { timeout: 240_000 }).toBeGreaterThanOrEqual(2);
    // Let the tasks finish (a card for a tool such as Bash is allowed, if one comes).
    const allow = page.getByRole("button", { name: "Allow", exact: true });
    const started = Date.now();
    while (Date.now() - started < 600_000) {
      if (team.board.length > 0 && team.board.every((t) => ["done", "failed", "stopped"].includes(t.status)))
        break;
      if (await allow.first().isVisible()) await allow.first().click();
      await page.waitForTimeout(2_000);
    }
    await page.screenshot({ path: testInfo.outputPath("after.png") });

    const board = team.board.map((t) => ({
      agent: t.agent,
      title: t.title,
      scope: t.scope ?? "(none: the whole model)",
      brief: t.brief ?? "(none)",
      status: t.status,
      startedAt: t.startedAt,
      finishedAt: t.finishedAt,
      waitedFor: t.waitingFor,
      summary: t.summary,
    }));
    const writers = team.board.filter(
      (t) => t.startedAt && t.finishedAt && t.agent !== "reviewer" && t.agent !== "climate",
    );
    const overlapped = writers.some((a) =>
      writers.some(
        (b) =>
          a !== b && (a.startedAt ?? 0) < (b.finishedAt ?? 0) && (b.startedAt ?? 0) < (a.finishedAt ?? 0),
      ),
    );
    const owners: Record<string, number> = {};
    for (const e of Object.values(bridge.scene.scene.doc.elements)) {
      const owner = e.tags?.["hai.owner"] ?? "(none)";
      owners[owner] = (owners[owner] ?? 0) + 1;
    }
    const report = { board, overlappedInTime: overlapped, elementsByOwner: owners };
    console.log(`LIVE parallel: ${JSON.stringify(report, null, 2)}`);
    writeFileSync(testInfo.outputPath("report.json"), JSON.stringify(report, null, 2));
    expect(team.board.length).toBeGreaterThan(0);
  } finally {
    await bridge.stop();
  }
});
