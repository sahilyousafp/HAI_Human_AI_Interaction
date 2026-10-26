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

// Urban asks open data for what is around the site: portals, buildings, vegetation and urban metrics. The hosts are a
// local stand-in; with Open data off no request is made and no tool is offered.

let bridge: Awaited<ReturnType<typeof startTestBridge>> | null = null;
let server = openDataServer();
test.afterEach(async () => {
  await (bridge?.agent as Team | null)?.stopAll();
  await bridge?.stop();
  bridge = null;
});

async function start(page: Page, openData: boolean) {
  server = openDataServer();
  bridge = await startTestBridge(page, {
    agent: fakeProvider(mkdtempSync(join(tmpdir(), "hai-e2e-urban-"))),
    openData: { transport: server.transport, gapMs: 0 },
  });
  bridge.site.set(TEST_SITE);
  await openViewer(page);
  await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
  await expect(page.getByTestId("agent-status")).toHaveAttribute("data-state", "idle");
  if (openData) {
    await openSettings(page, "open-data");
    await page.getByTestId("open-data-switch").click();
    await expect(page.getByTestId("open-data-switch")).toHaveAttribute("aria-checked", "true");
    await closeSettings(page);
  }
  return bridge.agent as Team;
}

/** Calls one of the bridge's tools the way Urban does (with its role's tools), and returns the text it gets back. */
async function ask(_team: Team, tool: string, args: Record<string, unknown> = {}) {
  const urban = defaultRoster().find((m) => m.name === "urban");
  if (!urban || !bridge) throw new Error("no urban");
  const token = bridge.agentTokens.issue({ agent: "urban", tools: allowedHaiTools(urban) });
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
const held = (page: Page) => page.evaluate(() => window.__HAI_VIEWER__?.context?.());

test("Urban fetches the buildings and trees around the site into the context layer and reports sources and heights", async ({
  page,
}) => {
  const team = await start(page, true);
  const said = JSON.parse(await ask(team, "urban_buildings", { radius_m: 300 }));
  expect(said.source).toBe("OpenStreetMap (Overpass)");
  expect(said.attribution).toContain("OpenStreetMap contributors");
  expect(said.data.buildings).toMatchObject({
    fetched: 3,
    inTheLayer: 3,
    heights: { measured: 1, inferred: 1, default: 1 },
  });
  expect(said.data.trees).toMatchObject({ fetched: 2 });
  expect(said.inferred).toMatch(/2 of 3 heights are worked out/);
  expect(said.observedAt).toBe("2026-10-25T10:00:00.000Z");
  await expect.poll(() => held(page)).toMatchObject({ buildings: 3, trees: 2, visible: true });
  await expect(page.getByTestId("context-credits")).toContainText("OpenStreetMap contributors");
  // Only the site's box went out: no project name, no element, nothing of the model.
  const sent = decodeURIComponent(server.bodies[0] ?? "");
  expect(sent).toMatch(
    /^data=\[out:json\]\[timeout:25\];\(way\["building"\]\(52\.\d+,4\.\d+,52\.\d+,4\.\d+\);node\["natural"="tree"\]/,
  );
  expect(sent).not.toMatch(/block|wall|column|mixed-use/i);
  // The list in Settings shows the host that was contacted.
  await openSettings(page, "open-data");
  await expect(page.getByTestId("open-data-record")).toContainText("overpass-api.de");
});

test("the vegetation cover, the greenness overlay and the urban metrics, each with where it came from", async ({
  page,
}) => {
  const team = await start(page, true);
  await ask(team, "urban_buildings", { radius_m: 300 });
  // Before the vegetation is fetched, the green share is missing, with how to fetch it.
  const before = JSON.parse(await ask(team, "urban_metrics", { radius_m: 200 }));
  expect(before.buildings.count).toBeGreaterThan(0);
  expect(before.greenShare.missing).toMatch(/urban_vegetation \(radius_m 200\)/);
  const veg = JSON.parse(await ask(team, "urban_vegetation", { radius_m: 200 }));
  expect(veg.landCover.source).toBe("ESA WorldCover");
  expect(veg.landCover.data.shares.tree).toBeGreaterThan(0.4);
  expect(veg.landCover.data.year).toBe(2021);
  expect(veg.greenness.data.scene).toMatchObject({ id: "S2-test", date: "2026-10-20T10:30:00Z" });
  expect(veg.greenness.data.mean).toBeGreaterThan(0.3);
  await expect.poll(() => held(page)).toMatchObject({ rasters: 1 });
  await expect(page.getByTestId("context-legend")).toContainText("Greenness (NDVI)");
  await expect(page.getByTestId("context-legend")).toContainText("Sentinel-2 (Earth Search), 2026-10-20");
  const after = JSON.parse(await ask(team, "urban_metrics", { radius_m: 200 }));
  expect(after.greenShare.value).toBeGreaterThan(0.6);
  expect(after.greenShare.basis).toContain("WorldCover");
  expect(after.basis.map((b: { source: string }) => b.source)).toEqual(
    expect.arrayContaining(["OpenStreetMap (Overpass)", "Sentinel-2 (Earth Search)"]),
  );
});

test("a portal search and a table read come back with publisher, licence and the rows that fit", async ({
  page,
}) => {
  const team = await start(page, true);
  const found = JSON.parse(
    await ask(team, "open_data_search", { portal: "catalog.data.gov", query: "street trees" }),
  );
  expect(found.data.datasets[0]).toMatchObject({
    title: "Street trees",
    publisher: "City Parks",
    licence: "CC BY",
  });
  const table = JSON.parse(
    await ask(team, "open_data_get", {
      portal: "catalog.data.gov",
      dataset: "street-trees",
      resource: "res-1",
    }),
  );
  expect(table.data).toMatchObject({ columns: ["species"], total: 2, truncated: false });
  // A portal that is not on the list is refused with how to add it, and nothing was sent to it.
  const refused = await ask(team, "open_data_search", { portal: "data.not-listed.example", query: "x" });
  expect(refused).toMatch(/not one of the portals/);
  expect(server.calls.some((c) => c.includes("not-listed"))).toBe(false);
});

test("with Open data off Urban has no data tool, nothing is requested and the layer stays empty", async ({
  page,
}) => {
  const team = await start(page, false);
  const said = await ask(team, "urban_buildings", { radius_m: 300 });
  expect(said).toMatch(/Refused/);
  expect(server.calls).toEqual([]);
  expect(await held(page)).toMatchObject({ buildings: 0 });
});

test("without a site the tools say to set it and make no request", async ({ page }) => {
  const team = await start(page, true);
  bridge?.site.set(null);
  const said = await ask(team, "urban_buildings", { radius_m: 300 });
  expect(said).toMatch(/no site yet/);
  expect(said).toMatch(/site_set/);
  expect(server.calls).toEqual([]);
});
