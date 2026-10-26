// Runs against the real, signed-in Claude Code CLI, so it is manual: CI and a plain `pnpm test:e2e` skip it. Run it with
//   HAI_LIVE_CLAUDE=1 pnpm exec playwright test e2e/open-checks-live.spec.ts
// Checks that only the real CLI can answer, each printing what happened (for docs/decisions.md):
//  - a read-only helper subagent started by Architect (add-agent-workers 4.2),
//  - a worker's panel offer waiting behind its parent's open panel (6.3),
//  - how Mochi gets information onto the Dynamic UI panel (it has no panel tools of its own).
import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { ask, ENDED, start, until } from "./live-support.ts";

const live = process.env.HAI_LIVE_CLAUDE === "1";
test.skip(!live, "manual: needs the signed-in Claude Code CLI (HAI_LIVE_CLAUDE=1)");
test("4.2: Architect starts a read-only helper subagent, and a helper named after a teammate cannot model", async ({
  page,
}, testInfo) => {
  test.setTimeout(600_000);
  const { bridge, team } = await start(page);
  try {
    const count = () => Object.keys(bridge.scene.scene.doc.elements).length;
    const before = count();
    await ask(
      page,
      "Architect, use your Task tool to start the `reviewer` subagent and ask it to try to add a wall to the model with any modelling tool you can find, then tell me exactly what it answered. Do not add a wall yourself.",
    );
    // Mochi may answer alone or hand it to Architect; either way the helper is a subagent of whoever asks for it.
    const started = Date.now();
    const ended = await until(
      page,
      async () => {
        const idle = (await page.getByTestId("agent-status").getAttribute("data-state")) === "idle";
        const settled = team.board.every((t) => ENDED.includes(t.status));
        return idle && settled && Date.now() - started > 15_000;
      },
      420_000,
    );
    await page.waitForTimeout(2_000);
    await page.screenshot({ path: testInfo.outputPath("helper.png") });
    const chips = (await page.getByTestId("tool-chip").allInnerTexts()).map((t) =>
      t.replace(/\s+/g, " ").trim(),
    );
    const replies = await page.getByTestId("agent-turn").allInnerTexts();
    const report = {
      ended,
      elementsBefore: before,
      elementsAfter: count(),
      toolChips: chips,
      startedAHelper: chips.some((c) => /\b(Agent|Task)\b/.test(c)),
      board: team.board.map((t) => ({ agent: t.agent, status: t.status, summary: t.summary })),
      reply: replies.join("\n").slice(-2500),
    };
    console.log(`LIVE helper: ${JSON.stringify(report, null, 2)}`);
    writeFileSync(testInfo.outputPath("helper.json"), JSON.stringify(report, null, 2));
    expect(report.startedAHelper).toBe(true);
    expect(report.elementsAfter).toBe(before);
  } finally {
    await bridge.stop();
  }
});

test("6.3: a worker's panel offer waits behind its parent's open panel, and both complete", async ({
  page,
}, testInfo) => {
  test.setTimeout(900_000);
  const { bridge, team } = await start(page);
  try {
    await ask(
      page,
      "Architect, do two things at the same time. First, you yourself offer me a panel (offer_panel) to tune the clearance between column col-a1 and the north wall. Second, start one worker (spawn_worker, part sample/roof) whose instruction is to offer me a panel (offer_panel) to choose a slab thickness for a new roof slab, then make it. Both panels are my choice; wait for me.",
    );
    const waiting: string[] = [];
    const opened: string[] = [];
    const frame = page.getByTestId("generated-panel");
    let openedAt = 0;
    await until(
      page,
      () => team.board.length > 0 && team.board.every((t) => ENDED.includes(t.status)),
      800_000,
      async () => {
        for (const t of team.board) if (bridge.panels.stateOf(t.agent) === "waiting") waiting.push(t.agent);
        if (await frame.isVisible().catch(() => false)) {
          openedAt ||= Date.now();
          // Keep the first panel open long enough for the other offer to arrive and queue, then close it.
          if (waiting.length > 0 || Date.now() - openedAt > 45_000) {
            await page.screenshot({ path: testInfo.outputPath(`open-${opened.length}.png`) });
            opened.push(
              (await page
                .getByTestId("panel-agent")
                .textContent()
                .catch(() => "")) ?? "",
            );
            await page.getByTestId("panel-done").click();
            openedAt = 0;
          }
        } else if (await page.getByTestId("offer-card").first().isVisible()) {
          await page.evaluate(() =>
            window.__HAI_INPUT__?.gestures([{ type: "head.nod", ts: Date.now(), confidence: 1 }]),
          );
        }
      },
    );
    const report = {
      queuedAgents: [...new Set(waiting)],
      panelsOpenedFor: opened,
      board: team.board.map((t) => ({
        agent: t.agent,
        kind: t.kind ?? "task",
        status: t.status,
        summary: t.summary,
      })),
    };
    console.log(`LIVE panel queue: ${JSON.stringify(report, null, 2)}`);
    writeFileSync(testInfo.outputPath("panel-queue.json"), JSON.stringify(report, null, 2));
    expect(team.board.length).toBeGreaterThan(0);
  } finally {
    await bridge.stop();
  }
});

const MONITORED = [
  [
    "asked directly",
    "Mochi, put a summary of the model on a panel for me: how many elements of each type there are and the overall size. Information only, change nothing.",
  ],
  [
    "asked to use a specialist",
    "Mochi, have Architect put a summary of the model on a panel for me: how many elements of each type there are and the overall size. Information only, change nothing.",
  ],
] as const;

for (const [how, request] of MONITORED)
  test(`monitor: how Mochi gets information onto the Dynamic UI panel, ${how}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(600_000);
    const { bridge, team } = await start(page);
    try {
      const started = Date.now();
      const seconds = () => Math.round((Date.now() - started) / 100) / 10;
      const steps: string[] = [];
      const seenChips = new Set<string>();
      const note = (text: string) => {
        steps.push(`${seconds()} s: ${text}`);
        console.log(`MONITOR ${steps.at(-1)}`);
      };
      let sawOffer = false;
      let nodded = false;
      let panelHtml = "";
      let panelAgent = "";
      await ask(page, request);
      await until(
        page,
        async () => {
          // Over when the specialists are done and the offer was seen, or when Mochi answered alone and went idle.
          if (team.board.length > 0) return team.board.every((t) => ENDED.includes(t.status)) && sawOffer;
          const idle = await page.getByTestId("agent-status").getAttribute("data-state");
          return idle === "idle" && seconds() > 20;
        },
        420_000,
        async () => {
          for (const chip of await page.getByTestId("tool-chip").all()) {
            const text = (
              await chip
                .locator("summary")
                .innerText()
                .catch(() => "")
            )
              .replace(/\s+/g, " ")
              .trim();
            if (text && !seenChips.has(text)) {
              seenChips.add(text);
              note(`tool: ${text}`);
            }
          }
          for (const t of team.board)
            if (!steps.some((s) => s.endsWith(`task ${t.agent}: ${t.title}`)))
              note(`task ${t.agent}: ${t.title}`);
          const offer = page.getByTestId("offer-card").first();
          if (!sawOffer && (await offer.isVisible())) {
            sawOffer = true;
            note(
              `offer from ${await offer.getByTestId("offer-agent").textContent()}: ${await offer.getByTestId("offer-purpose").textContent()}`,
            );
            await page.screenshot({ path: testInfo.outputPath("1-offer.png") });
          }
          if (sawOffer && !nodded && (await offer.isVisible())) {
            nodded = true;
            await page.evaluate(() =>
              window.__HAI_INPUT__?.gestures([{ type: "head.nod", ts: Date.now(), confidence: 1 }]),
            );
          }
          const shell = page.getByTestId("panel-title");
          if (!panelHtml && (await shell.isVisible().catch(() => false))) {
            panelAgent =
              (await page
                .getByTestId("panel-agent")
                .textContent()
                .catch(() => "")) ?? "";
            await page.waitForTimeout(4_000);
            panelHtml = (await page.getByTestId("panel-frame").getAttribute("srcdoc")) ?? "";
            note(`panel "${await shell.textContent()}" by ${panelAgent}, ${panelHtml.length} characters`);
            await page.screenshot({ path: testInfo.outputPath("2-panel.png") });
          }
        },
      );
      await page.waitForTimeout(2_000);
      if (panelHtml) {
        const text = await page
          .frameLocator('[data-testid="panel-frame"]')
          .locator("body")
          .innerText()
          .catch(() => "");
        note(`panel text: ${text.replace(/\s+/g, " ").slice(0, 600)}`);
        writeFileSync(testInfo.outputPath("panel-document.html"), panelHtml);
      }
      const elements = Object.values(bridge.scene.scene.doc.elements);
      const truth: Record<string, number> = {};
      for (const e of elements) truth[e.type] = (truth[e.type] ?? 0) + 1;
      const report = { steps, panelAgent, panelCharacters: panelHtml.length, modelCountsByType: truth };
      console.log(`LIVE mochi panel: ${JSON.stringify(report, null, 2)}`);
      writeFileSync(testInfo.outputPath("mochi-panel.json"), JSON.stringify(report, null, 2));
      const reply = await page
        .getByTestId("agent-turn")
        .last()
        .innerText()
        .catch(() => "");
      note(`Mochi's reply: ${reply.replace(/\s+/g, " ").slice(0, 500)}`);
      expect(steps.length).toBeGreaterThan(0);
    } finally {
      await bridge.stop();
    }
  });
