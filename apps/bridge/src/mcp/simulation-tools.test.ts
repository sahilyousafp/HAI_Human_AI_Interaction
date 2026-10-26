import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import { type LandsatOptions, landsatItem, landsatTransport } from "../../test/landsat-fixture.ts";
import { connectClient } from "../../test/ws-client.ts";
import type { Transport } from "../open-data/client.ts";
import { type Bridge, createBridge } from "../server.ts";
import type { Caller } from "./agent-tokens.ts";

const ORIGIN = "http://localhost:5173";
const TOKEN = "simulation-test-token-0123456789";
let bridge: Bridge | null = null;
const sockets: WebSocket[] = [];
const clients: Client[] = [];

afterEach(async () => {
  for (const c of clients.splice(0)) await c.close();
  for (const ws of sockets.splice(0)) ws.close();
  await bridge?.stop();
  bridge = null;
});

async function start(transport?: Transport): Promise<AddressInfo> {
  const root = mkdtempSync(join(tmpdir(), "hai-simulation-bridge-"));
  bridge = createBridge({
    host: "127.0.0.1",
    port: 0,
    allowedOrigins: [ORIGIN],
    version: "t",
    token: TOKEN,
    settingsFile: join(root, ".hai", "settings.json"),
    scene: { projectDir: join(root, "project"), saveDelayMs: 50 },
    ...(transport ? { openData: { transport, gapMs: 0 } } : {}),
  });
  return bridge.start();
}

async function mcp(address: AddressInfo, caller: Caller) {
  if (!bridge) throw new Error("no bridge");
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${bridge.agentTokens.issue(caller)}` } },
    }),
  );
  clients.push(client);
  return client;
}

const SIMULATION: Caller = {
  agent: "simulation",
  tools: new Set(["surface_temperature", "simulation_geometry", "site_set", "get_elements"]),
};
const page = (address: AddressInfo) =>
  connectClient(address, { token: TOKEN, origin: ORIGIN, track: sockets });
const textOf = (result: { content?: unknown }) =>
  (result.content as Array<{ text?: string }> | undefined)?.[0]?.text ?? "";
const json = (result: { content?: unknown }) => JSON.parse(textOf(result));
const names = async (client: Client) => (await client.listTools()).tools.map((t) => t.name);

async function openDataOn(address: AddressInfo) {
  const browser = await page(address);
  browser.send("settings.set", { features: { openData: true } });
  await browser.waitFor("settings.snapshot", (m) => m.payload.features?.openData === true);
  return browser;
}

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

describe("Simulation tools", () => {
  it("simulation_geometry is always offered, surface_temperature only while Open data is on", async () => {
    const address = await start();
    const agent = await mcp(address, SIMULATION);
    const listed = await names(agent);
    expect(listed).toContain("simulation_geometry");
    expect(listed).not.toContain("surface_temperature");
    await openDataOn(address);
    expect(await names(await mcp(address, SIMULATION))).toContain("surface_temperature");
  });

  it("simulation_geometry describes the model in metres with the site and lists what it simplified", async () => {
    const address = await start();
    const browser = await page(address);
    browser.send("site.set", { site: { lat: 52.37, lon: 4.9, northDeg: 15 } });
    await browser.waitFor("site.snapshot", (m) => m.payload.site !== null);
    const writer = await mcp(address, { agent: "architect", tools: null });
    const made = await writer.callTool({
      name: "create_elements",
      arguments: {
        elements: [
          {
            id: "w1",
            name: "North wall",
            type: "wall",
            level: "L0",
            start: [0, 0],
            end: [6000, 0],
            height: 3000,
            thickness: 200,
          },
        ],
      },
    });
    expect(made.isError).toBeFalsy();
    const geometry = json(
      await (await mcp(address, SIMULATION)).callTool({ name: "simulation_geometry", arguments: {} }),
    );
    expect(geometry).toMatchObject({
      units: "m",
      up: "Z",
      site: { lat: 52.37, lon: 4.9, northDegCounterClockwiseFromY: 15 },
    });
    expect(geometry.objects).toContainEqual(
      expect.objectContaining({
        id: "w1",
        kind: "wall",
        start: [0, 0],
        end: [6, 0],
        thicknessM: 0.2,
        heightM: 3,
      }),
    );
    expect(geometry.simplified.length).toBeGreaterThan(0);
    expect(geometry.shading).toBeUndefined();
  });

  it("with include_context the neighbouring buildings come as shading objects", async () => {
    const address = await start();
    const agent = await mcp(address, SIMULATION);
    const geometry = json(
      await agent.callTool({ name: "simulation_geometry", arguments: { include_context: true } }),
    );
    expect(geometry.shading).toEqual([]);
    expect(geometry.site).toBeNull();
  });

  it("surface_temperature without a site says to set it, and sends nothing", async () => {
    const calls: NonNullable<LandsatOptions["calls"]> = [];
    const address = await start(landsatTransport({ calls }));
    await openDataOn(address);
    const agent = await mcp(address, SIMULATION);
    const result = await agent.callTool({ name: "surface_temperature", arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/site/i);
    expect(calls).toEqual([]);
  });

  it("surface_temperature reports the scene's date and age and that it is surface, not air, temperature, and puts an overlay in the layer", async () => {
    const calls: NonNullable<LandsatOptions["calls"]> = [];
    const address = await start(
      landsatTransport({ qualifying: [landsatItem("LC09_new", daysAgo(7), 3.2)], calls }),
    );
    const browser = await openDataOn(address);
    browser.send("site.set", { site: { lat: 52.37, lon: 4.9 } });
    await browser.waitFor("site.snapshot", (m) => m.payload.site !== null);
    const agent = await mcp(address, SIMULATION);
    const told = json(await agent.callTool({ name: "surface_temperature", arguments: { radius_m: 300 } }));
    expect(told.source).toMatch(/Planetary Computer/);
    expect(told.cached).toBe(false);
    expect(told.ageMinutes).toBeGreaterThan(6 * 24 * 60);
    expect(told.ageMinutes).toBeLessThan(8 * 24 * 60);
    expect(told.data.scene.id).toBe("LC09_new");
    expect(told.data.minC).toBeCloseTo(24, 0);
    expect(told.data.maxC).toBeCloseTo(36, 0);
    expect(told.data.note).toMatch(/surface, not air temperature/);
    const layer = await browser.waitFor("context.snapshot", (m) =>
      m.payload.items.some((i: { kind: string }) => i.kind === "raster"),
    );
    expect(layer.payload.items.find((i: { kind: string }) => i.kind === "raster")).toMatchObject({
      quantity: "Surface temperature (not air)",
      unit: "degrees C",
    });
    // Only a place and a radius went out: no model, no names.
    for (const call of calls) expect(call.body ?? "").not.toMatch(/North wall/);
  });

  it("with no usable scene the agent is told when the last one was, and no value", async () => {
    const address = await start(
      landsatTransport({ qualifying: [], anyScene: [landsatItem("LC09_cloudy", daysAgo(10), 88)] }),
    );
    const browser = await openDataOn(address);
    browser.send("site.set", { site: { lat: 52.37, lon: 4.9 } });
    await browser.waitFor("site.snapshot", (m) => m.payload.site !== null);
    const agent = await mcp(address, SIMULATION);
    const result = await agent.callTool({ name: "surface_temperature", arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/cloud|scene/i);
    expect(textOf(result)).not.toMatch(/minC|meanC/);
  });
});
