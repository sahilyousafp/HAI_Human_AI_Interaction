import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import type { Team } from "../apps/bridge/src/agent/team.ts";
import type { Transport } from "../apps/bridge/src/open-data/client.ts";
import { fakeProvider } from "../apps/bridge/test/fake-provider.ts";
import { closeSettings, openSettings } from "./settings.ts";
import { openViewer, startTestBridge } from "./viewer.ts";

// Settings > Open data: off by default, the sources with their hosts and licences, the portals, the site and the
// record of what was contacted. The hosts are never reached: the bridge is given a stand-in transport.

const answer: Transport = async () => ({
  status: 200,
  headers: { "content-type": "application/json" },
  body: Buffer.from("{}"),
});

test("Open data is off by default and lists every source with its host and licence", async ({
  page,
}, testInfo) => {
  const bridge = await startTestBridge(page, { openData: { transport: answer, gapMs: 0 } });
  try {
    await openViewer(page);
    await openSettings(page, "open-data");
    await expect(page.getByTestId("open-data-switch")).toHaveAttribute("aria-checked", "false");
    const sources = page.getByTestId("open-data-sources");
    await expect(sources).toContainText("MET Norway");
    await expect(sources).toContainText("api.met.no");
    await expect(sources).toContainText("ODbL 1.0");
    await expect(page.getByTestId("source-open-meteo")).toContainText("non-commercial");
    await expect(page.getByTestId("source-ack-open-meteo")).toBeVisible();
    await expect(page.getByTestId("source-switch-open-meteo")).toHaveCount(0);
    await expect(page.getByTestId("open-data-record")).toContainText("None yet");
    await page.screenshot({ path: testInfo.outputPath("open-data-light.png") });
    expect([...bridge.openData.record.entries]).toEqual([]);
  } finally {
    await bridge.stop();
  }
});

test("the switch turns it on, a source can be switched off, and a limited source needs 'I understand'", async ({
  page,
}) => {
  const bridge = await startTestBridge(page, { openData: { transport: answer, gapMs: 0 } });
  try {
    await openViewer(page);
    await openSettings(page, "open-data");
    await page.getByTestId("open-data-switch").click();
    await expect(page.getByTestId("open-data-switch")).toHaveAttribute("aria-checked", "true");
    await expect.poll(() => bridge.agent === null && true).toBe(true);
    // A request is allowed now, and recorded.
    await bridge.openData.client.request({
      source: "met-norway",
      kind: "weather",
      url: "https://api.met.no/x",
      ttlMs: 0,
    });
    await expect(page.getByTestId("open-data-record")).toContainText("api.met.no");
    await expect(page.getByTestId("open-data-record")).toContainText("weather");
    // One source off: its request is refused.
    await page.getByTestId("source-switch-met-norway").click();
    await expect(page.getByTestId("source-switch-met-norway")).toHaveAttribute("aria-checked", "false");
    await expect(
      bridge.openData.client.request({
        source: "met-norway",
        kind: "weather",
        url: "https://api.met.no/y",
        ttlMs: 0,
      }),
    ).rejects.toMatchObject({ code: "off" });
    // The limited source: acknowledged, it becomes a switch and is allowed.
    await page.getByTestId("source-ack-open-meteo").click();
    await expect(page.getByTestId("source-switch-open-meteo")).toHaveAttribute("aria-checked", "true");
    await expect(
      bridge.openData.client.request({
        source: "open-meteo",
        kind: "weather",
        url: "https://api.open-meteo.com/x",
        ttlMs: 0,
      }),
    ).resolves.toBeTruthy();
    // Clearing the list leaves nothing in it.
    await page.getByTestId("open-data-clear").click();
    await expect(page.getByTestId("open-data-record")).toContainText("None yet");
    // Switching it off ends requests at once.
    await page.getByTestId("open-data-switch").click();
    await expect(
      bridge.openData.client.request({
        source: "overpass",
        kind: "buildings",
        url: "https://overpass-api.de/x",
        ttlMs: 0,
      }),
    ).rejects.toMatchObject({ code: "off" });
  } finally {
    await bridge.stop();
  }
});

test("the site is entered, checked and saved with the project, and cleared", async ({ page }) => {
  const bridge = await startTestBridge(page, { openData: { transport: answer, gapMs: 0 } });
  try {
    await openViewer(page);
    await openSettings(page, "open-data");
    await expect(page.getByTestId("site-state")).toHaveText("No site yet");
    await page.getByTestId("site-lat").fill("120");
    await page.getByTestId("site-lon").fill("4.9");
    await page.getByTestId("site-save").click();
    await expect(page.getByTestId("site-state")).toContainText("Latitude must be from -90 to 90");
    expect(bridge.site.site).toBeNull();
    await page.getByTestId("site-lat").fill("52.37");
    await page.getByTestId("site-north").fill("12");
    await page.getByTestId("site-save").click();
    await expect(page.getByTestId("site-state")).toContainText("Saved: 52.37, 4.9");
    await expect.poll(() => bridge.site.site).toMatchObject({ lat: 52.37, lon: 4.9, northDeg: 12 });
    await page.getByTestId("site-clear").click();
    await expect(page.getByTestId("site-state")).toHaveText("No site yet");
    await expect.poll(() => bridge.site.site).toBeNull();
  } finally {
    await bridge.stop();
  }
});

test("portals: the starter list is shown, a host can be added and removed, and a bad one is refused", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: "dark" });
  const bridge = await startTestBridge(page, { openData: { transport: answer, gapMs: 0 } });
  try {
    await openViewer(page);
    await openSettings(page, "open-data");
    const list = page.getByTestId("portal-list");
    await expect(list).toContainText("catalog.data.gov");
    await page.getByTestId("portal-input").fill("https://x.example/y");
    await page.getByTestId("portal-add").click();
    await expect(page.getByTestId("portal-error")).toBeVisible();
    await page.getByTestId("portal-input").fill("data.example.org");
    await page.getByTestId("portal-add").click();
    await expect(list).toContainText("added by you");
    await page.screenshot({ path: testInfo.outputPath("open-data-dark.png") });
    await page.getByTestId("portal-remove-data.example.org").click();
    await expect(list).not.toContainText("added by you");
    await closeSettings(page);
  } finally {
    await bridge.stop();
  }
});

test.describe("an agent proposes the site", () => {
  let bridge: Awaited<ReturnType<typeof startTestBridge>> | null = null;
  test.afterEach(async () => {
    await (bridge?.agent as Team | null)?.stopAll();
    await bridge?.stop();
    bridge = null;
  });

  async function start(page: Page) {
    bridge = await startTestBridge(page, {
      agent: fakeProvider(mkdtempSync(join(tmpdir(), "hai-e2e-site-"))),
      openData: { transport: answer, gapMs: 0 },
    });
    await openViewer(page);
    await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
    await expect(page.getByTestId("agent-status")).toHaveAttribute("data-state", "idle");
    await openSettings(page, "open-data");
    await page.getByTestId("open-data-switch").click();
    await expect(page.getByTestId("open-data-switch")).toHaveAttribute("aria-checked", "true");
    await closeSettings(page);
    return bridge.agent as Team;
  }
  const propose = `delegate climate: tool site_set {"latitude":52.37,"longitude":4.9,"north_deg":10}`;

  test("a card shows the values and has no Always allow; Allow saves the site", async ({ page }) => {
    const team = await start(page);
    await team.request(propose);
    const card = page.getByTestId("approval-card").last();
    await expect(card).toBeVisible();
    await expect(page.getByTestId("approval-summary").last()).toHaveText(
      "Set the project's site to latitude 52.37, longitude 4.9, true north 10 degrees from +Y",
    );
    await expect(page.getByTestId("approval-agent").last()).toHaveText("Climate");
    await expect(card.getByRole("button", { name: "Always allow" })).toHaveCount(0);
    expect(bridge?.site.site).toBeNull();
    await card.getByRole("button", { name: "Allow", exact: true }).click();
    await expect.poll(() => bridge?.site.site).toMatchObject({ lat: 52.37, lon: 4.9, northDeg: 10 });
    await team.settled();
    await openSettings(page, "open-data");
    await expect(page.getByTestId("site-state")).toContainText("Saved: 52.37, 4.9");
  });

  test("Deny saves nothing and the agent is told", async ({ page }) => {
    const team = await start(page);
    await team.request(propose);
    const card = page.getByTestId("approval-card").last();
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Deny" }).click();
    await team.settled();
    expect(bridge?.site.site).toBeNull();
    expect(team.board.at(-1)?.summary ?? "").toMatch(/declined|Refused|denied/i);
  });

  test("asking again asks again: Allow is never remembered", async ({ page }) => {
    const team = await start(page);
    for (const lon of [4.9, 5.1]) {
      await team.request(`delegate climate: tool site_set {"latitude":52.37,"longitude":${lon}}`);
      const card = page.getByTestId("approval-card").last();
      await expect(card).toBeVisible();
      await card.getByRole("button", { name: "Allow", exact: true }).click();
      await expect.poll(() => bridge?.site.site?.lon).toBe(lon);
      await team.settled();
    }
  });
});
