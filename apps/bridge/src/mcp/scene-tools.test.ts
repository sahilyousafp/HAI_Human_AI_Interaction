import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Element } from "@aex/protocol";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import { connectClient } from "../../test/ws-client.ts";
import { type Bridge, createBridge } from "../server.ts";
import type { Caller } from "./agent-tokens.ts";

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

/** An agent's own MCP token, as the bridge writes it into the agent's mcp.json. */
const agentToken = (caller: Caller = { agent: null, tools: null }) => {
  if (!bridge) throw new Error("no bridge");
  return bridge.agentTokens.issue(caller);
};

/** An MCP client as the agent would be one: its bearer token, no Origin. */
async function mcp(address: AddressInfo, token = agentToken()) {
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
      (await post(address, { authorization: `Bearer ${agentToken()}`, origin: "https://evil.example" }))
        .status,
    ).toBe(403);
  });

  it("the browsers' session token is not an agent token", async () => {
    const address = await start();
    expect((await post(address, { authorization: `Bearer ${TOKEN}` })).status).toBe(401);
    expect((await post(address, { authorization: `Bearer ${agentToken()}` })).status).toBe(200);
  });

  it("a new token for an agent revokes its previous one; other agents' tokens keep working", async () => {
    const address = await start();
    const first = agentToken({ agent: "architect", tools: null });
    const climate = agentToken({ agent: "climate", tools: null });
    const second = agentToken({ agent: "architect", tools: null });
    expect((await post(address, { authorization: `Bearer ${first}` })).status).toBe(401);
    expect((await post(address, { authorization: `Bearer ${second}` })).status).toBe(200);
    expect((await post(address, { authorization: `Bearer ${climate}` })).status).toBe(200);
  });

  it("reviewer cannot edit: only its read tools are offered, and a write call is refused", async () => {
    const address = await start();
    const reviewer = await mcp(
      address,
      agentToken({
        agent: "reviewer",
        tools: new Set(["get_scene_summary", "get_elements", "get_user_context", "capture_view"]),
      }),
    );
    const { tools } = await reviewer.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "approve_tool",
      "capture_view",
      "get_elements",
      "get_scene_summary",
      "get_user_context",
    ]);
    const before = structuredClone(bridge?.scene.scene.doc);
    const refused = await reviewer
      .callTool({ name: "delete_elements", arguments: { ids: ["block-b"] } })
      .then(
        (result) => textOf(result),
        (error: Error) => error.message,
      );
    expect(refused).toMatch(/not found|unknown/i);
    expect(bridge?.scene.scene.doc).toEqual(before);
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
        "sun_study",
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

  it("imported geometry: the agent sees layer, colour and box, never triangles, and can move it", async () => {
    const address = await start();
    const agent = await mcp(address);
    const element: Element = {
      id: "imp-1",
      type: "imported",
      name: "Facade panel",
      properties: {},
      asset: "0f8fad5b-d9cb-469f-a165-70867728950e",
      part: 0,
      bounds: { min: [0, 0, 0], max: [2000, 1000, 3000] },
      translation: [0, 0, 0],
      layer: "Facade",
      color: "#ff0000",
    };
    bridge?.scene.handle(
      { type: "scene.apply", id: "m1", payload: { label: "Import", ops: [{ op: "create", element }] } },
      () => {},
    );
    const found = json(await agent.callTool({ name: "get_elements", arguments: { type: "imported" } }));
    expect(found.elements).toEqual([element]);
    expect(JSON.stringify(found)).not.toMatch(/positions|indices|vertices/);
    const summary = json(await agent.callTool({ name: "get_scene_summary", arguments: {} }));
    expect(summary.counts.imported).toBe(1);

    const moved = await agent.callTool({
      name: "update_elements",
      arguments: { updates: [{ id: "imp-1", patch: { translation: [1000, 0, 0] } }] },
    });
    expect(moved.isError).toBeFalsy();
    const after = json(await agent.callTool({ name: "get_elements", arguments: { ids: ["imp-1"] } }));
    expect(after.elements[0].translation).toEqual([1000, 0, 0]);
    expect(after.elements[0].asset).toBe(element.asset);

    const copied = await agent.callTool({
      name: "create_elements",
      arguments: {
        elements: [{ ...element, id: "imp-2", name: "Facade panel copy", translation: [5000, 0, 0] }],
      },
    });
    expect(copied.isError).toBeFalsy();
    const both = json(await agent.callTool({ name: "get_elements", arguments: { type: "imported" } }));
    expect(both.elements.map((e: { id: string }) => e.id)).toEqual(["imp-1", "imp-2"]);
    const deleted = await agent.callTool({ name: "delete_elements", arguments: { ids: ["imp-2"] } });
    expect(deleted.isError).toBeFalsy();
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

describe("sun study", () => {
  const climate = () => agentToken({ agent: "climate", tools: new Set(["sun_study", "get_scene_summary"]) });
  const winter = { date: "2026-12-21", time: "12:00", latitude: 51.5, longitude: 0 };

  it("winter shadows: the viewer's sun is set to about 15 degrees from the south, and Climate gets a picture", async () => {
    const address = await start();
    const viewer = await connectClient(address, { token: TOKEN, origin: ORIGIN, track: sockets });
    const result = (await mcp(address, climate())).callTool({ name: "sun_study", arguments: winter });
    const request = await viewer.waitFor("view.capture");
    expect(request.payload.sun).toMatchObject({ label: "2026-12-21 12:00, 51.5 N 0 E" });
    expect(request.payload.sun?.altitude).toBeCloseTo(15.2, 0);
    expect(request.payload.sun?.azimuth).toBeCloseTo(180, 0);
    viewer.send("view.captured", { requestId: request.payload.requestId, png: "iVBORw0KGgoAAAA" });
    const { content } = (await result) as { content: Array<{ type: string; text?: string; data?: string }> };
    expect(JSON.parse(content[0]?.text ?? "{}")).toMatchObject({
      from: "S",
      aboveHorizon: true,
      utc: "2026-12-21T12:00:00.000Z",
    });
    expect(content[1]).toMatchObject({ type: "image", data: "iVBORw0KGgoAAAA" });
  });

  it("local time follows the longitude unless an offset is given; at night the sun is below the horizon", async () => {
    const address = await start();
    const agent = await mcp(address, climate());
    const tokyo = json(
      await agent.callTool({
        name: "sun_study",
        arguments: { date: "2026-06-21", time: "23:30", latitude: 35.7, longitude: 139.7 },
      }),
    );
    expect(tokyo).toMatchObject({ aboveHorizon: false, utc: "2026-06-21T14:30:00.000Z" });
    expect(tokyo.view).toMatch(/No viewer is open/);
    const offset = json(
      await agent.callTool({ name: "sun_study", arguments: { ...winter, utcOffsetHours: 1 } }),
    );
    expect(offset.utc).toBe("2026-12-21T11:00:00.000Z");
  });

  it("only agents given the tool have it", async () => {
    const address = await start();
    const reviewer = await mcp(address, agentToken({ agent: "reviewer", tools: new Set(["get_elements"]) }));
    expect((await reviewer.listTools()).tools.map((t) => t.name)).not.toContain("sun_study");
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
