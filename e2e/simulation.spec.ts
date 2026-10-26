import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { allowedHaiTools, defaultRoster } from "../apps/bridge/src/agent/roster.ts";
import type { Team } from "../apps/bridge/src/agent/team.ts";
import { fakeProvider } from "../apps/bridge/test/fake-provider.ts";
import { openDataServer, TEST_SITE } from "../apps/bridge/test/open-data-server.ts";
import { closeSettings, openSettings } from "./settings.ts";
import { openViewer, startTestBridge } from "./viewer.ts";

// Simulation reads the ground's surface temperature from open satellite data, says how old and what kind of
// temperature it is, and asks the user before each call to the Ladybug Tools server the user installed. The hosts are
// a local stand-in, and the Ladybug server is the fake CLI's scripted call.

let bridge: Awaited<ReturnType<typeof startTestBridge>> | null = null;
let server = openDataServer();
test.afterEach(async () => {
  await (bridge?.agent as Team | null)?.stopAll();
  await bridge?.stop();
  bridge = null;
});

async function start(page: Page, options: { openData: boolean; agent?: boolean }) {
  server = openDataServer();
  bridge = await startTestBridge(page, {
    openData: { transport: server.transport, gapMs: 0 },
    ...(options.agent ? { agent: fakeProvider(mkdtempSync(join(tmpdir(), "hai-e2e-simulation-"))) } : {}),
  });
  bridge.site.set(TEST_SITE);
  await openViewer(page);
  if (options.agent) {
    await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
    await expect(page.getByTestId("agent-status")).toHaveAttribute("data-state", "idle");
  }
  if (options.openData) {
    await openSettings(page, "open-data");
    await page.getByTestId("open-data-switch").click();
    await expect(page.getByTestId("open-data-switch")).toHaveAttribute("aria-checked", "true");
    await closeSettings(page);
  }
  return bridge;
}

/** Calls one of the bridge's tools the way Simulation does (with its role's tools). */
async function ask(tool: string, args: Record<string, unknown> = {}) {
  const simulation = defaultRoster().find((m) => m.name === "simulation");
  if (!simulation || !bridge) throw new Error("no simulation");
  const token = bridge.agentTokens.issue({ agent: "simulation", tools: allowedHaiTools(simulation) });
  const res = await fetch(`http://127.0.0.1:${bridge.port}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: tool, arguments: args },
    }),
  });
  const body = await res.text();
  const data = res.headers.get("content-type")?.includes("text/event-stream")
    ? (body
        .split(String.fromCharCode(10))
        .filter((l) => l.startsWith("data:"))
        .at(-1)
        ?.slice(5) ?? "null")
    : body;
  const reply = JSON.parse(data) as {
    result?: { content?: Array<{ text?: string }>; isError?: boolean };
    error?: { message?: string };
  };
  if (reply.error) return `Refused: ${reply.error.message}`;
  return reply.result?.content?.[0]?.text ?? "";
}

test("the ground's surface temperature comes with its date, its age and that it is not air temperature, and is drawn with a legend", async ({
  page,
}, testInfo) => {
  await start(page, { openData: true });
  const said = JSON.parse(await ask("surface_temperature", { radius_m: 300, threshold_c: 30 }));
  expect(said.source).toMatch(/Planetary Computer/);
  expect(said.licence).toMatch(/public domain|CC0|USGS/i);
  expect(said.data.scene).toMatchObject({ id: "LC09_test", platform: "landsat-9" });
  expect(said.data.minC).toBeCloseTo(24, 0);
  expect(said.data.maxC).toBeCloseTo(36, 0);
  expect(said.data.threshold.shareAbove).toBeGreaterThan(0.4);
  expect(said.data.note).toMatch(/surface, not air temperature/);
  expect(said.ageMinutes).toBeGreaterThan(6 * 24 * 60);
  expect(said.ageMinutes).toBeLessThan(8 * 24 * 60);
  // The ground overlay is in the city layer, with its legend naming the quantity, unit, scene date and source.
  await expect
    .poll(() => page.evaluate(() => window.__HAI_VIEWER__?.context?.()))
    .toMatchObject({ rasters: 1 });
  const legend = page.getByTestId("context-legend");
  await expect(legend).toContainText("Surface temperature (not air)");
  await expect(legend).toContainText("degrees C");
  await expect(legend).toContainText("Landsat (Planetary Computer)");
  // Only the site's place and the radius went out: no model, no names.
  const bodies = server.bodies.join(" ");
  expect(bodies).not.toMatch(/Fake column|col-a1/);
  await openSettings(page, "open-data");
  await expect(page.getByTestId("open-data-record")).toContainText("planetarycomputer.microsoft.com");
  await closeSettings(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: testInfo.outputPath("surface-temperature-light.png") });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(500);
  await page.screenshot({ path: testInfo.outputPath("surface-temperature-dark.png") });
});

test("with Open data off Simulation has no surface temperature tool and nothing is requested, but still gets the geometry", async ({
  page,
}) => {
  await start(page, { openData: false });
  expect(await ask("surface_temperature")).toMatch(/Refused/);
  const geometry = JSON.parse(await ask("simulation_geometry"));
  expect(geometry).toMatchObject({ units: "m", up: "Z", site: { lat: 52.37, lon: 4.9 } });
  expect(geometry.simplified.length).toBeGreaterThan(0);
  expect(server.calls).toEqual([]);
});

test.describe("the user's Ladybug Tools server", () => {
  const sunPath = `delegate simulation: mcp ladybug LB_SunPath {"latitude":52.37}`;

  test("each call raises a card naming Simulation and Ladybug; Allow runs it, and asking again asks again", async ({
    page,
  }) => {
    const b = await start(page, { openData: false, agent: true });
    const team = b.agent as Team;
    for (let run = 0; run < 2; run++) {
      await team.request(sunPath);
      const card = page.getByTestId("approval-card").last();
      await expect(card).toBeVisible();
      await expect(page.getByTestId("approval-agent").last()).toHaveText("Simulation");
      await expect(card).toContainText("ladybug");
      await expect(card).toContainText("LB_SunPath");
      await card.getByRole("button", { name: "Allow", exact: true }).click();
      await team.settled();
      expect(team.board.at(-1)?.summary ?? "").toContain("ladybug ran LB_SunPath");
    }
  });

  test("Deny runs nothing and Simulation is told", async ({ page }) => {
    const b = await start(page, { openData: false, agent: true });
    const team = b.agent as Team;
    await team.request(sunPath);
    const card = page.getByTestId("approval-card").last();
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Deny" }).click();
    await team.settled();
    const summary = team.board.at(-1)?.summary ?? "";
    expect(summary).not.toContain("ladybug ran");
    expect(summary).toMatch(/Not run|declined/i);
  });
});
