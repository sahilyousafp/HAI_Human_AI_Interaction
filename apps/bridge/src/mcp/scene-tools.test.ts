import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import { connectClient } from "../../test/ws-client.ts";
import { type Bridge, createBridge } from "../server.ts";

const ORIGIN = "http://localhost:5173";
const TOKEN = "mcp-test-token-0123456789";
let bridge: Bridge | null = null;
const sockets: WebSocket[] = [];
const clients: Client[] = [];

afterEach(async () => {
  for (const c of clients.splice(0)) await c.close();
  for (const ws of sockets.splice(0)) ws.close();
  await bridge?.stop();
  bridge = null;
});

async function start(): Promise<AddressInfo> {
  const projectDir = join(mkdtempSync(join(tmpdir(), "aex-mcp-")), "project");
  bridge = createBridge({
    host: "127.0.0.1",
    port: 0,
    allowedOrigins: [ORIGIN],
    version: "t",
    token: TOKEN,
    scene: { projectDir, saveDelayMs: 50 },
  });
  return bridge.start();
}

/** An MCP client as the agent would be one: bearer token, no Origin. */
async function mcp(address: AddressInfo, token = TOKEN) {
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  clients.push(client);
  return client;
}

const json = (result: { content?: unknown }) => {
  const first = (result.content as Array<{ type: string; text?: string }> | undefined)?.[0];
  return JSON.parse(first?.text ?? "null");
};
const textOf = (result: { content?: unknown }) =>
  (result.content as Array<{ text?: string }> | undefined)?.[0]?.text ?? "";

describe("MCP endpoint access", () => {
  const initialize = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "1" } },
  };
  const post = (address: AddressInfo, headers: Record<string, string>) =>
    fetch(`http://127.0.0.1:${address.port}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify(initialize),
    });

  it("MCP request without token: an authentication error, and no tool runs", async () => {
    const address = await start();
    const res = await post(address, {});
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/token/);
  });

  it("refuses a wrong token", async () => {
    const address = await start();
    expect((await post(address, { authorization: "Bearer not-the-token" })).status).toBe(401);
  });

  it("refuses a request from a foreign web page, even with the token", async () => {
    const address = await start();
    expect(
      (await post(address, { authorization: `Bearer ${TOKEN}`, origin: "https://evil.example" })).status,
    ).toBe(403);
  });

  it("serves the scene tools to a client with the token", async () => {
    const address = await start();
    const { tools } = await (await mcp(address)).listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "approve_tool",
        "capture_view",
        "create_elements",
        "delete_elements",
        "get_elements",
        "get_scene_summary",
        "get_user_context",
        "set_selection",
        "update_elements",
      ].sort(),
    );
  });
});

describe("read tools", () => {
  it("summary of the sample scene: levels, counts by type and the bounding box in millimetres", async () => {
    const address = await start();
    const summary = json(await (await mcp(address)).callTool({ name: "get_scene_summary", arguments: {} }));
    expect(summary.units).toBe("mm");
    expect(summary.levels.map((l: { id: string }) => l.id)).toEqual(["L0", "L1", "L2"]);
    expect(summary.counts).toEqual({ slab: 3, column: 9, wall: 4, massing: 2 });
    expect(summary.bounds.max[2]).toBe(21_000); // the tower
    expect(summary.bounds.min[2]).toBeLessThan(0); // the site slab hangs below ground level
  });

  it("get_elements filters by type and level, and reports ids it did not find", async () => {
    const address = await start();
    const agent = await mcp(address);
    const walls = json(
      await agent.callTool({ name: "get_elements", arguments: { type: "wall", level: "L1" } }),
    );
    expect(walls.elements.map((e: { id: string }) => e.id).sort()).toEqual([
      "wall-e",
      "wall-n",
      "wall-s",
      "wall-w",
    ]);
    const byId = json(
      await agent.callTool({ name: "get_elements", arguments: { ids: ["block-b", "nope"] } }),
    );
    expect(byId.elements[0].size).toEqual([12_000, 12_000, 21_000]);
    expect(byId.notFound).toEqual(["nope"]);
  });

  it("pointed element reported: the column under the hand pointer, and the selection", async () => {
    const address = await start();
    const viewer = await connectClient(address, { token: TOKEN, origin: ORIGIN, track: sockets });
    viewer.send("selection.set", { ids: ["block-b"] });
    viewer.send("context.update", {
      pointed: "col-a1",
      camera: { azimuth: 305, elevation: 32, distance: 70, target: [20, 15, 3] },
    });
    await viewer.waitFor("selection.changed");
    const context = json(await (await mcp(address)).callTool({ name: "get_user_context", arguments: {} }));
    expect(context.pointed).toEqual({ id: "col-a1", name: "Column A1", type: "column", level: "L0" });
    expect(context.selection.map((e: { id: string }) => e.id)).toEqual(["block-b"]);
    expect(context.camera.azimuth).toBe(305);
  });
});

describe("write tools", () => {
  const wall = (id: string, height: number) => ({
    id,
    name: id,
    type: "wall",
    level: "L0",
    start: [0, 30_000],
    end: [6000, 30_000],
    height,
    thickness: 200,
  });

  it("invalid batch is atomic: one zero-height wall of three, nothing created, the error names it", async () => {
    const address = await start();
    const agent = await mcp(address);
    const result = await agent.callTool({
      name: "create_elements",
      arguments: { elements: [wall("w1", 3000), wall("w2", 0), wall("w3", 3000)] },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/w2/);
    expect(textOf(result)).toMatch(/height/);
    expect(Object.keys(bridge?.scene.scene.doc.elements ?? {}).filter((id) => /^w\d$/.test(id))).toEqual([]);
  });

  it("creates, updates and deletes; created elements get ids when the agent gives none", async () => {
    const address = await start();
    const agent = await mcp(address);
    const created = json(
      await agent.callTool({
        name: "create_elements",
        arguments: { elements: [{ ...wall("", 3000), id: undefined, name: "North fence" }] },
      }),
    );
    const [newId] = created.created;
    expect(newId).toMatch(/^wall-/);
    await agent.callTool({
      name: "update_elements",
      arguments: { updates: [{ id: newId, patch: { height: 1200 } }] },
    });
    expect(bridge?.scene.scene.doc.elements[newId]).toMatchObject({ height: 1200 });
    await agent.callTool({ name: "delete_elements", arguments: { ids: [newId] } });
    expect(bridge?.scene.scene.doc.elements[newId]).toBeUndefined();
  });

  it("set_selection selects for everyone", async () => {
    const address = await start();
    const viewer = await connectClient(address, { token: TOKEN, origin: ORIGIN, track: sockets });
    await (await mcp(address)).callTool({ name: "set_selection", arguments: { ids: ["block-c"] } });
    await viewer.waitFor("selection.changed", (m) => m.payload.ids[0] === "block-c");
  });

  it("undo a whole turn: four columns and a moved wall are reverted by one undo", async () => {
    const address = await start();
    const viewer = await connectClient(address, { token: TOKEN, origin: ORIGIN, track: sockets });
    const agent = await mcp(address);
    const wallBefore = structuredClone(bridge?.scene.scene.doc.elements["wall-s"]);
    bridge?.scene.beginTurn("add four columns and move the south wall");
    for (const x of [0, 4000, 8000, 12_000]) {
      await agent.callTool({
        name: "create_elements",
        arguments: {
          elements: [
            {
              type: "column",
              name: `Agent column ${x}`,
              position: [x, -5000],
              section: [400, 400],
              height: 3000,
            },
          ],
        },
      });
    }
    await agent.callTool({
      name: "update_elements",
      arguments: { updates: [{ id: "wall-s", patch: { start: [4000, 3500], end: [20_000, 3500] } }] },
    });
    bridge?.scene.endTurn();
    // The viewer saw each change live...
    await viewer.waitFor("scene.patch", (m) => m.payload.ops.some((op) => op.op === "update"));
    // ...and one undo reverts the whole turn.
    viewer.send("scene.undo", {});
    await viewer.waitFor("scene.patch", (m) => m.payload.kind === "undo");
    const doc = bridge?.scene.scene.doc;
    expect(Object.values(doc?.elements ?? {}).filter((e) => e.name.startsWith("Agent column"))).toEqual([]);
    expect(doc?.elements["wall-s"]).toEqual(wallBefore);
  });
});
