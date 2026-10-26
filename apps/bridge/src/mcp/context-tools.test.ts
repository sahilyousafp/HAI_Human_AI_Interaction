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
const WRITE = new Set([...READ, "create_elements", "update_elements", "context_adopt"]);

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

  it("a reader is offered the reading tools and not context_adopt, and cannot adopt", async () => {
    const agent = await mcp(await start(), { agent: "urban", tools: READ });
    const listed = (await agent.listTools()).tools.map((t) => t.name);
    expect(listed).toEqual(expect.arrayContaining(["context_list", "context_get"]));
    expect(listed).not.toContain("context_adopt");
    await expect(agent.callTool({ name: "context_adopt", arguments: { ids: ["way/1"] } })).rejects.toThrow(
      /not found/,
    );
    expect(Object.values(bridge?.scene.scene.doc.elements ?? {}).some((e) => e.id.startsWith("ctx-"))).toBe(
      false,
    );
  });

  it("a writer adopts a neighbour: an ordinary element, tagged with its source, in the model but not in the layer's way", async () => {
    const agent = await mcp(await start(), { agent: "architect", tools: WRITE });
    const adopted = json(await agent.callTool({ name: "context_adopt", arguments: { ids: ["way/1"] } }));
    expect(adopted.adopted).toEqual(["ctx-way-1"]);
    const element = bridge?.scene.scene.doc.elements["ctx-way-1"];
    expect(element).toMatchObject({
      type: "slab",
      thickness: 12_000,
      tags: { "context.id": "way/1", "context.source": expect.stringContaining("OpenStreetMap") },
    });
    // The layer keeps its own copy.
    expect(bridge?.context.items.some((i) => i.id === "way/1")).toBe(true);
    // It is one undo step.
    expect(bridge?.scene.scene.canUndo).toBe(true);
    bridge?.scene.scene.undo();
    expect(bridge?.scene.scene.doc.elements["ctx-way-1"]).toBeUndefined();
  });

  it("refuses what cannot be adopted, with the reason, and changes nothing", async () => {
    const agent = await mcp(await start(), { agent: "architect", tools: WRITE });
    const before = Object.keys(bridge?.scene.scene.doc.elements ?? {}).length;
    for (const [ids, reason] of [
      [["nowhere"], /no item "nowhere"/],
      [["node/9"], /only buildings/],
      [["way/1", "node/9"], /only buildings/],
    ] as const) {
      const refused = await agent.callTool({ name: "context_adopt", arguments: { ids: [...ids] } });
      expect(refused.isError).toBe(true);
      expect(textOf(refused)).toMatch(reason);
    }
    await agent.callTool({ name: "context_adopt", arguments: { ids: ["way/2"] } });
    const again = await agent.callTool({ name: "context_adopt", arguments: { ids: ["way/2"] } });
    expect(textOf(again)).toMatch(/already in the model/);
    expect(Object.keys(bridge?.scene.scene.doc.elements ?? {}).length).toBe(before + 1);
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
