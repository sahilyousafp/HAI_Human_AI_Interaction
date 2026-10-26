// Runs against the real, signed-in Claude Code CLI and the real open-data servers, so it is manual: CI and a plain
// `pnpm test:e2e` skip it. Run it with
//   HAI_LIVE_CLAUDE=1 pnpm exec playwright test e2e/urban-simulation-live.spec.ts
// Each test asks one of the new agents a plain question about a real site and prints what happened (the tools it
// called, what it answered) for docs/decisions.md and demos/19-urban-and-simulation.md.
import { writeFileSync } from "node:fs";
import { expect, type Page, type TestInfo, test } from "@playwright/test";
import type { Team } from "../apps/bridge/src/agent/team.ts";
import { ClaudeCliProvider } from "../packages/agent-core/src/index.ts";
import { Site } from "../packages/protocol/src/index.ts";
import { ask, ENDED, until } from "./live-support.ts";
import { closeSettings, openSettings } from "./settings.ts";
import { openViewer, startTestBridge } from "./viewer.ts";

const live = process.env.HAI_LIVE_CLAUDE === "1";
test.skip(!live, "manual: needs the signed-in Claude Code CLI and the internet (HAI_LIVE_CLAUDE=1)");

/** Central Amsterdam: dense enough to have many buildings, and a place the real sources cover. */
const SITE = Site.parse({ lat: 52.3731, lon: 4.8922 });

async function session(page: Page, openData = true) {
  const bridge = await startTestBridge(page, { agent: new ClaudeCliProvider() });
  bridge.site.set(SITE);
  await openViewer(page);
  await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
  await expect(page.getByTestId("agent-status")).toHaveAttribute("data-state", "idle", { timeout: 60_000 });
  if (openData) {
    await openSettings(page, "open-data");
    await page.getByTestId("open-data-switch").click();
    await expect(page.getByTestId("open-data-switch")).toHaveAttribute("aria-checked", "true");
    await closeSettings(page);
    await expect(page.getByTestId("agent-status")).toHaveAttribute("data-state", "idle", { timeout: 60_000 });
  }
  return { bridge, team: bridge.agent as Team };
}

/** Asks one question, lets the agents finish (allowing any card), and reports the tools called and the answer. */
async function run(page: Page, testInfo: TestInfo, name: string, request: string, team: Team) {
  const started = Date.now();
  await ask(page, request);
  const ended = await until(
    page,
    async () => {
      const idle = (await page.getByTestId("agent-status").getAttribute("data-state")) === "idle";
      return idle && team.board.every((t) => ENDED.includes(t.status)) && Date.now() - started > 15_000;
    },
    540_000,
  );
  await page.waitForTimeout(2_000);
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`) });
  const chips = (await page.getByTestId("tool-chip").allInnerTexts()).map((t) =>
    t.replace(/\s+/g, " ").trim(),
  );
  const turns = await page.getByTestId("agent-turn").allInnerTexts();
  const report = {
    request,
    ended,
    seconds: Math.round((Date.now() - started) / 1000),
    toolChips: chips,
    board: team.board.map((t) => ({ agent: t.agent, status: t.status, summary: t.summary })),
    reply: turns.join("\n").slice(-2500),
  };
  console.log(`LIVE ${name}: ${JSON.stringify(report, null, 2)}`);
  writeFileSync(testInfo.outputPath(`${name}.json`), JSON.stringify(report, null, 2));
  return report;
}

/** The hosts the bridge actually contacted: a specialist's own tool calls are not in the chat, but every request is recorded. */
const contacted = (bridge: { openData: { record: { entries: Iterable<{ host: string }> } } }) =>
  [...new Set([...bridge.openData.record.entries].map((e) => e.host))].sort();

test("Urban: the buildings and green cover around the site, with where the numbers came from", async ({
  page,
}, testInfo) => {
  test.setTimeout(900_000);
  const { bridge, team } = await session(page);
  try {
    const report = await run(
      page,
      testInfo,
      "urban",
      "Urban, fetch the buildings within 150 m of the site and the green cover there, then tell me how many buildings there are, how tall the tallest is, what share is green, and where the data came from.",
      team,
    );
    expect(report.ended).toBe(true);
    console.log(`LIVE urban hosts: ${contacted(bridge).join(", ")}`);
    expect(contacted(bridge)).toContain("overpass-api.de");
  } finally {
    await bridge.stop();
  }
});

test("Climate: the weather at the site now, with its source and age", async ({ page }, testInfo) => {
  test.setTimeout(600_000);
  const { bridge, team } = await session(page);
  try {
    const report = await run(
      page,
      testInfo,
      "climate",
      "Climate, what is the weather at the site right now? Say where the data came from and how old it is.",
      team,
    );
    expect(report.ended).toBe(true);
    console.log(`LIVE climate hosts: ${contacted(bridge).join(", ")}`);
    expect(contacted(bridge).some((h) => h === "api.met.no" || h === "api.weather.gov")).toBe(true);
  } finally {
    await bridge.stop();
  }
});

test("Simulation: the ground temperature with its date and that it is not air temperature, and a sun study", async ({
  page,
}, testInfo) => {
  test.setTimeout(900_000);
  const { bridge, team } = await session(page);
  try {
    const report = await run(
      page,
      testInfo,
      "simulation",
      "Simulation, what is the temperature of the ground around the site, and how long ago was it measured? Then run a sun study for 21 June at noon and say how much shade the neighbours put on the site.",
      team,
    );
    expect(report.ended).toBe(true);
    console.log(`LIVE simulation hosts: ${contacted(bridge).join(", ")}`);
    expect(contacted(bridge)).toContain("planetarycomputer.microsoft.com");
  } finally {
    await bridge.stop();
  }
});

test("Simulation without Ladybug installed says how to install it and offers what it can do", async ({
  page,
}, testInfo) => {
  test.setTimeout(600_000);
  const { bridge, team } = await session(page);
  try {
    const report = await run(
      page,
      testInfo,
      "simulation-no-ladybug",
      "Simulation, run an annual daylight simulation of the model with Ladybug.",
      team,
    );
    expect(report.ended).toBe(true);
    expect(report.reply).toMatch(/ladybug/i);
  } finally {
    await bridge.stop();
  }
});

test("Mochi opens an information panel of its own", async ({ page }, testInfo) => {
  test.setTimeout(600_000);
  const { bridge, team } = await session(page, false);
  try {
    let sawOffer = false;
    const started = Date.now();
    await ask(
      page,
      "Mochi, put a summary of the model on a panel for me: how many elements of each type there are and the overall size. Information only, change nothing.",
    );
    const ended = await until(
      page,
      async () => {
        const idle = (await page.getByTestId("agent-status").getAttribute("data-state")) === "idle";
        return idle && team.board.every((t) => ENDED.includes(t.status)) && Date.now() - started > 20_000;
      },
      420_000,
      async () => {
        const offer = page.getByTestId("offer-card").first();
        if (await offer.isVisible()) {
          sawOffer = true;
          const agent = await offer.getByTestId("offer-agent").textContent();
          console.log(`LIVE mochi offer from ${agent}`);
          await page.evaluate(() =>
            window.__HAI_INPUT__?.gestures([{ type: "head.nod", ts: Date.now(), confidence: 1 }]),
          );
        }
      },
    );
    await page.waitForTimeout(3_000);
    const panelAgent = await page
      .getByTestId("panel-agent")
      .textContent()
      .catch(() => null);
    const doneButton = await page.getByTestId("panel-done").count();
    await page.screenshot({ path: testInfo.outputPath("mochi-panel.png") });
    const chips = (await page.getByTestId("tool-chip").allInnerTexts()).map((t) =>
      t.replace(/\s+/g, " ").trim(),
    );
    const report = { ended, sawOffer, panelAgent, doneButtons: doneButton, toolChips: chips };
    console.log(`LIVE mochi-panel: ${JSON.stringify(report, null, 2)}`);
    writeFileSync(testInfo.outputPath("mochi-panel.json"), JSON.stringify(report, null, 2));
    expect(ended).toBe(true);
  } finally {
    await bridge.stop();
  }
});
