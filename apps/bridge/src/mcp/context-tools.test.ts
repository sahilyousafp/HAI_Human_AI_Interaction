import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ContextItem, Site } from "@hai/protocol";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import { connectClient } from "../../test/ws-client.ts";
import { type Bridge, createBridge } from "../server.ts";
import type { Caller } from "./agent-tokens.ts";

const ORIGIN = "http://localhost:5173";
const TOKEN = "context-test-token-0123456789";
let bridge: Bridge | null = null;
const sockets: WebSocket[] = [];
const clients: Client[] = [];

afterEach(async () => {
  for (const c of clients.splice(0)) await c.close();
  for (const ws of sockets.splice(0)) ws.close();
  await bridge?.stop();
  bridge = null;
});

const site = Site.parse({ lat: 52.37, lon: 4.9 });
const building = (id: string, x: number): ContextItem => ({
  id,
  kind: "building",
  footprint: [
    [x, 0],
    [x + 10_000, 0],
    [x + 10_000, 8_000],
    [x, 8_000],
  ],
  heightMm: 12_000,
  heightSource: "inferred",
  baseMm: 0,
  source: "overpass",
});

async function start(): Promise<AddressInfo> {
  const root = mkdtempSync(join(tmpdir(), "hai-context-bridge-"));
  bridge = createBridge({
    host: "127.0.0.1",
    port: 0,
    allowedOrigins: [ORIGIN],
    version: "t",
    token: TOKEN,
    scene: { projectDir: join(root, "project"), saveDelayMs: 50 },
  });
  const address = await bridge.start();
  bridge.site.set(site);
  bridge.context.replace(
    "overpass",
    "building",
    [building("way/1", 20_000), building("way/2", 60_000), building("way/3", 150_000)],
    site,
    "2026-10-01",
  );
  bridge.context.replace(
    "overpass",
    "tree",
    [{ id: "node/9", kind: "tree", position: [5_000, 5_000], source: "overpass" }],
    site,
  );
  return address;
}

async function mcp(address: AddressInfo, caller: Caller) {
  if (!bridge) throw new Error("no bridge");
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${bridge.agentTokens.issue(caller)}` } },
  });
  await client.connect(transport);
  clients.push(client);
  return client;
}

const textOf = (result: { content?: unknown }) =>
  (result.content as Array<{ text?: string }> | undefined)?.[0]?.text ?? "";
const json = (result: { content?: unknown }) => JSON.parse(textOf(result));
const READ = new Set(["get_elements", "context_list", "context_get"]);
const CLEAR = new Set([...READ, "context_clear"]);

describe("context tools", () => {
  it("context_list says what the layer holds, where it came from and that it is current", async () => {
    const agent = await mcp(await start(), { agent: "urban", tools: READ });
    const told = json(await agent.callTool({ name: "context_list", arguments: {} }));
    expect(told.counts).toEqual({ building: 3, tree: 1, raster: 0 });
    expect(told.buildingHeights).toEqual({ measured: 0, inferred: 3, default: 0 });
    expect(told.stale).toBe(false);
    expect(told.credits[0]).toMatchObject({
      attribution: expect.stringContaining("OpenStreetMap"),
      date: "2026-10-01",
    });
  });

  it("context_get returns the nearest items first, and says when it cut the list short", async () => {
    const agent = await mcp(await start(), { agent: "urban", tools: READ });
    const first = json(
      await agent.callTool({ name: "context_get", arguments: { kind: "building", limit: 2 } }),
    );
    expect(first.items.map((i: { id: string }) => i.id)).toEqual(["way/1", "way/2"]);
    expect(first).toMatchObject({ total: 3, returned: 2 });
    expect(first.note).toMatch(/left out/);
    const near = json(
      await agent.callTool({ name: "context_get", arguments: { x_mm: 150_000, radius_m: 20 } }),
    );
    expect(near.items.map((i: { id: string }) => i.id)).toEqual(["way/3"]);
    expect(near.note).toBeUndefined();
  });

  it("the layer stays context: no tool brings it into the model", async () => {
    const agent = await mcp(await start(), { agent: "architect", tools: null });
    const listed = (await agent.listTools()).tools.map((t) => t.name);
    expect(listed).toEqual(expect.arrayContaining(["context_list", "context_get", "context_clear"]));
    expect(listed).not.toContain("context_adopt");
  });

  it("context_clear empties the layer for everyone, says how much went, and leaves the model and the site alone", async () => {
    const address = await start();
    // An element in the model, which clearing the layer leaves alone.
    bridge?.scene.handle(
      {
        type: "scene.apply",
        id: "m1",
        payload: {
          label: "Block",
          ops: [
            {
              op: "create",
              element: {
                id: "ctx-way-1",
                type: "massing",
                name: "Neighbour",
                properties: {},
                origin: [0, 0, 0],
                size: [1000, 1000, 1000],
              },
            },
          ],
        },
      },
      () => {},
    );
    const browser = await connectClient(address, { token: TOKEN, origin: ORIGIN, track: sockets });
    await browser.waitFor("context.snapshot");
    const urban = await mcp(address, { agent: "urban", tools: CLEAR });
    const cleared = json(await urban.callTool({ name: "context_clear", arguments: {} }));
    expect(cleared.cleared).toEqual({ building: 3, tree: 1, raster: 0 });
    await browser.waitFor("context.snapshot", (m) => m.payload.items.length === 0);
    expect(json(await urban.callTool({ name: "context_list", arguments: {} })).counts).toEqual({
      building: 0,
      tree: 0,
      raster: 0,
    });
    expect(bridge?.scene.scene.doc.elements["ctx-way-1"]).toBeDefined();
    expect(bridge?.site.site).toMatchObject({ lat: 52.37, lon: 4.9 });
  });

  it("the page's Clear context empties the layer too", async () => {
    const browser = await connectClient(await start(), { token: TOKEN, origin: ORIGIN, track: sockets });
    await browser.waitFor("context.snapshot");
    browser.send("context.clear", {});
    await browser.waitFor("context.snapshot", (m) => m.payload.items.length === 0);
    expect(bridge?.context.items).toHaveLength(0);
  });

  it("every connected page is sent the layer, and told when it goes stale", async () => {
    const address = await start();
    const browser = await connectClient(address, { token: TOKEN, origin: ORIGIN, track: sockets });
    const snapshot = await browser.waitFor("context.snapshot");
    expect(snapshot.payload.items).toHaveLength(4);
    expect(snapshot.payload.stale).toBe(false);
    browser.send("site.set", { site: { lat: 40, lon: -3 } });
    await browser.waitFor("context.snapshot", (m) => m.payload.stale === true);
  });
});
