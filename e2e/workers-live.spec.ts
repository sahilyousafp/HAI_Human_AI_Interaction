// Runs against the real, signed-in Claude Code CLI, so it is manual: CI and a plain `pnpm test:e2e` skip it. Run it with
//   HAI_LIVE_CLAUDE=1 pnpm exec playwright test e2e/workers-live.spec.ts
// The real Architect is asked to make two separate parts with workers. Does it start them (`spawn_worker`), with scopes
// inside its own claim, do the workers run at the same time, and does its task end after them? What happened is printed.
import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Team } from "../apps/bridge/src/agent/team.ts";
import { ClaudeCliProvider } from "../packages/agent-core/src/index.ts";
import { openViewer, startTestBridge } from "./viewer.ts";

const live = process.env.HAI_LIVE_CLAUDE === "1";
test.skip(!live, "manual: needs the signed-in Claude Code CLI (HAI_LIVE_CLAUDE=1)");

test("the real Architect splits its own task into workers that make the parts at the same time", async ({
  page,
}, testInfo) => {
  test.setTimeout(900_000);
  const bridge = await startTestBridge(page, { agent: new ClaudeCliProvider() });
  const team = bridge.agent as Team;
  try {
    await openViewer(page);
    await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
    await expect(page.getByTestId("agent-status")).toHaveAttribute("data-state", "idle", { timeout: 60_000 });
    mkdirSync(testInfo.outputDir, { recursive: true });
    await page
      .getByTestId("agent-input")
      .fill(
        "Architect, build a small pavilion on the empty ground in two separate parts, and use workers (spawn_worker) so the two parts are made at the same time: a hall (four columns and a slab roof, about 8 by 6 metres) and a pergola (six columns in a row with a beam on top), at least 4 metres apart.",
      );
    await page.getByTestId("agent-input").press("Enter");
    await expect.poll(() => team.board.length, { timeout: 240_000 }).toBeGreaterThanOrEqual(1);
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
      kind: t.kind ?? "task",
      parent: t.parent,
      title: t.title,
      scope: t.scope ?? "(none: the whole model)",
      status: t.status,
      startedAt: t.startedAt,
      finishedAt: t.finishedAt,
      summary: t.summary,
    }));
    const workers = team.board.filter((t) => t.kind === "worker" && t.startedAt && t.finishedAt);
    const overlapped = workers.some((a) =>
      workers.some(
        (b) =>
          a !== b && (a.startedAt ?? 0) < (b.finishedAt ?? 0) && (b.startedAt ?? 0) < (a.finishedAt ?? 0),
      ),
    );
    const owners: Record<string, number> = {};
    for (const e of Object.values(bridge.scene.scene.doc.elements)) {
      const owner = e.tags?.["hai.owner"] ?? "(none)";
      owners[owner] = (owners[owner] ?? 0) + 1;
    }
    const report = { board, workersOverlappedInTime: overlapped, elementsByOwner: owners };
    console.log(`LIVE workers: ${JSON.stringify(report, null, 2)}`);
    writeFileSync(testInfo.outputPath("report.json"), JSON.stringify(report, null, 2));
    expect(team.board.length).toBeGreaterThan(0);
  } finally {
    await bridge.stop();
  }
});
