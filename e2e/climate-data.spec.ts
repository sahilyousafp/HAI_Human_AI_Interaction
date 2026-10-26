import { expect, type Page, test } from "@playwright/test";
import { allowedHaiTools, defaultRoster } from "../apps/bridge/src/agent/roster.ts";
import { openDataServer, TEST_SITE } from "../apps/bridge/test/open-data-server.ts";
import { closeSettings, openSettings } from "./settings.ts";
import { openViewer, startTestBridge } from "./viewer.ts";

// Climate reads the weather and the climate of the site from open data, with the source and the age of every answer.
// The hosts are a local stand-in; with Open data off no tool is offered and nothing is requested.

let bridge: Awaited<ReturnType<typeof startTestBridge>> | null = null;
let server = openDataServer();
test.afterEach(async () => {
  await bridge?.stop();
  bridge = null;
});

async function start(page: Page, openData: boolean, site = true) {
  server = openDataServer();
  bridge = await startTestBridge(page, { openData: { transport: server.transport, gapMs: 0 } });
  if (site) bridge.site.set(TEST_SITE);
  await openViewer(page);
  if (openData) {
    await openSettings(page, "open-data");
    await page.getByTestId("open-data-switch").click();
    await expect(page.getByTestId("open-data-switch")).toHaveAttribute("aria-checked", "true");
    await closeSettings(page);
  }
}

/** Calls one of the bridge's tools the way Climate does (with its role's tools). */
async function ask(tool: string, args: Record<string, unknown> = {}) {
  const climate = defaultRoster().find((m) => m.name === "climate");
  if (!climate || !bridge) throw new Error("no climate");
  const token = bridge.agentTokens.issue({ agent: "climate", tools: allowedHaiTools(climate) });
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

test("the weather now, with the source, the licence and how old it is", async ({ page }) => {
  await start(page, true);
  const said = JSON.parse(await ask("weather_now"));
  expect(said.source).toBe("MET Norway");
  expect(said.licence).toContain("CC BY 4.0");
  expect(said.attribution).toContain("MET Norway");
  expect(said.data).toMatchObject({
    airTemperatureC: 11.5,
    relativeHumidityPercent: 82,
    windSpeedMs: 4.2,
    cloudCoverPercent: 75,
  });
  expect(said.data.place).toEqual({ lat: 52.37, lon: 4.9 });
  expect(said.observedAt).toBe(server.hour.replace("Z", ".000Z"));
  expect(said.ageMinutes).toBeGreaterThanOrEqual(0);
  expect(said.ageMinutes).toBeLessThan(65);
  expect(said.cached).toBe(false);
  // The request carried the place and nothing else.
  expect(server.calls[0]).toBe(
    "GET https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=52.3700&lon=4.9000",
  );
  // Asked again, it is answered from the saved answers.
  expect(server.calls.length).toBe(1);
  await openSettings(page, "open-data");
  await expect(page.getByTestId("open-data-record")).toContainText("api.met.no");
});

test("the forecast and the climate normals come with their sources too", async ({ page }) => {
  await start(page, true);
  const forecast = JSON.parse(await ask("weather_forecast", { hours: 2 }));
  expect(forecast.source).toBe("MET Norway");
  expect(forecast.data.hours.length).toBeGreaterThan(0);
  const normals = JSON.parse(await ask("climate_normals"));
  expect(normals.source).toBe("NASA POWER");
  expect(normals.data.months).toHaveLength(12);
  expect(normals.data.period).toBe("1991-2020");
  expect(normals.data.annual.airTemperatureC).not.toBeNull();
});

test("a place of its own is asked about without touching the site, and half a place is refused", async ({
  page,
}) => {
  await start(page, true);
  const there = JSON.parse(await ask("weather_now", { latitude: 40.4, longitude: -3.7 }));
  expect(there.data.place).toEqual({ lat: 40.4, lon: -3.7 });
  expect(server.calls[0]).toContain("lat=40.4000&lon=-3.7000");
  expect(bridge?.site.site).toMatchObject({ lat: 52.37 });
  expect(await ask("weather_now", { latitude: 40.4 })).toMatch(/both latitude and longitude/);
});

test("Open-Meteo stays off until the user acknowledges its limit", async ({ page }) => {
  await start(page, true);
  await openSettings(page, "open-data");
  await page.getByTestId("source-switch-met-norway").click();
  await closeSettings(page);
  // MET Norway is off and Open-Meteo is not acknowledged: no source is left.
  expect(await ask("weather_now")).toMatch(/No weather source is on/);
  expect(server.calls).toEqual([]);
  await openSettings(page, "open-data");
  await page.getByTestId("source-ack-open-meteo").click();
  await closeSettings(page);
  const said = JSON.parse(await ask("weather_now"));
  expect(said.source).toBe("Open-Meteo");
  expect(said.data.airTemperatureC).toBe(10.9);
});

test("with Open data off Climate has no weather tool and nothing is requested", async ({ page }) => {
  await start(page, false);
  expect(await ask("weather_now")).toMatch(/Refused/);
  expect(server.calls).toEqual([]);
});

test("without a site and without coordinates the tool says to set the site and makes no request", async ({
  page,
}) => {
  await start(page, true, false);
  const said = await ask("weather_now");
  expect(said).toMatch(/no site yet/);
  expect(said).toMatch(/site_set/);
  expect(server.calls).toEqual([]);
});
