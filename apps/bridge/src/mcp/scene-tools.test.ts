import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Element } from "@hai/protocol";
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
  const projectDir = join(mkdtempSync(join(tmpdir(), "hai-mcp-")), "project");
  bridge = createBridge({
    host: "127.0.0.1",
    port: 0,
    allowedOrigins: [ORIGIN],
    version: "t",
    token: TOKEN,
    mirrorDir: join(mkdtempSync(join(tmpdir(), "hai-mcp-mirror-")), "mirror"),
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
        "camera_capture",
        "camera_delete",
        "camera_list",
        "camera_set",
        "capture_view",
        "close_panel",
        "context_adopt",
        "context_get",
        "context_list",
        "create_elements",
        "delete_elements",
        "geometry_array_along_curve",
        "geometry_boolean",
        "geometry_loft",
        "geometry_offset",
        "geometry_sweep",
        "get_elements",
        "get_scene_summary",
        "get_user_context",
        "offer_panel",
        "open_panel",
        "python_run",
        "set_selection",
        "set_tags",
        "set_view",
        "simulation_geometry",
        "sun_study",
        "transform_elements",
        "update_elements",
        "update_panel",
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

  it("Markers are always included: the project's lettered markers, with their points", async () => {
    const address = await start();
    const viewer = await connectClient(address, { token: TOKEN, origin: ORIGIN, track: sockets });
    viewer.send("markers.set", {
      markers: [
        { letter: "A", point: [3000, 4000, 0] },
        { letter: "B", point: [9000, 9000, 0] },
      ],
    });
    await viewer.waitFor("markers.snapshot", (m) => m.payload.markers.length === 2);
    const context = json(await (await mcp(address)).callTool({ name: "get_user_context", arguments: {} }));
    expect(context.markers).toEqual([
      { letter: "A", point: [3000, 4000, 0] },
      { letter: "B", point: [9000, 9000, 0] },
    ]);
  });

  it("what the latest request pointed out: its held target, its points P1, P2 and its sketches", async () => {
    const address = await start();
    const viewer = await connectClient(address, { token: TOKEN, origin: ORIGIN, track: sockets });
    const sketch = {
      label: "S1",
      kind: "path",
      points: [
        [0, 0, 0],
        [6000, 0, 0],
      ],
    };
    viewer.send("agent.send", {
      text: "a wall along this",
      context: {
        references: [],
        selection: [],
        groundPoint: null,
        target: { kind: "point", point: [1000, 2000, 0], aid: null },
        points: [[4000, 2000, 0]],
        sketches: [sketch],
      },
    });
    const agent = await mcp(address);
    await expect
      .poll(async () => json(await agent.callTool({ name: "get_user_context", arguments: {} })).sketches)
      .toEqual([sketch]);
    const context = json(await agent.callTool({ name: "get_user_context", arguments: {} }));
    expect(context.target).toEqual({ kind: "point", point: [1000, 2000, 0], aid: null });
    expect(context.points).toEqual([{ label: "P1", point: [4000, 2000, 0] }]);
    expect(context.markers).toEqual([]);
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
    // The pictures are taken off-screen from a camera of the agent's own, with the sun for that picture only.
    expect(request.payload.cameras).toHaveLength(1);
    expect(request.payload.agent).toBe("climate");
    expect(request.payload.sun).toMatchObject({ label: "2026-12-21 12:00, 51.5 N 0 E" });
    expect(request.payload.sun?.altitude).toBeCloseTo(15.2, 0);
    expect(request.payload.sun?.azimuth).toBeCloseTo(180, 0);
    viewer.send("view.captured", {
      requestId: request.payload.requestId,
      shots: [{ camera: "iso-se", png: "iVBORw0KGgoAAAA", thumb: "data:image/jpeg;base64,/9j/" }],
    });
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
    const agent = await mcp(address, agentToken({ agent: "architect", tools: null }));
    const wallBefore = structuredClone(bridge?.scene.scene.doc.elements["wall-s"]);
    bridge?.scene.beginTurn("architect", "add four columns and move the south wall");
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
    bridge?.scene.endTurn("architect");
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

describe("panel tools", () => {
  const panelDoc = { title: "Clearance", width: 320, height: 240, html: "<p>hi</p>" };

  /** A browser connection that answers panel offers and reports panel loads, as the page does. */
  async function page(address: AddressInfo) {
    return connectClient(address, { token: TOKEN, origin: ORIGIN, track: sockets });
  }
  const offerOf = async (browser: Awaited<ReturnType<typeof page>>) =>
    (await browser.waitFor("panel.offer", (m) => m.payload.state === "waiting")).payload;
  const panelOf = async (browser: Awaited<ReturnType<typeof page>>) =>
    (await browser.waitFor("panel.open")).payload.panelId;
  /** The agent offers, the page accepts, the agent opens and the page reports it ready. */
  async function openPanel(address: AddressInfo) {
    const browser = await page(address);
    const agent = await mcp(address);
    const offered = agent.callTool({ name: "offer_panel", arguments: { purpose: "Set the clearance" } });
    const offer = await offerOf(browser);
    browser.send("panel.offer.answer", { offerId: offer.offerId, answer: "accepted" });
    expect(json(await offered).answer).toBe("accepted");
    const opened = agent.callTool({ name: "open_panel", arguments: panelDoc });
    const panelId = await panelOf(browser);
    browser.send("panel.status", { panelId, state: "ready" });
    expect(json(await opened)).toEqual({ status: "ready" });
    return { browser, agent, panelId };
  }

  it("the offer waits for the user and returns the answer; no approval card is shown", async () => {
    const address = await start();
    const browser = await page(address);
    const agent = await mcp(address);
    const offered = agent.callTool({
      name: "offer_panel",
      arguments: { purpose: "Set the wall to column clearance" },
    });
    const offer = await offerOf(browser);
    expect(offer.purpose).toBe("Set the wall to column clearance");
    expect(bridge?.approvals.waiting).toEqual([]);
    browser.send("panel.offer.answer", { offerId: offer.offerId, answer: "skipped" });
    const result = json(await offered);
    expect(result.answer).toBe("skipped");
    expect(result.next).toMatch(/chat/);
    expect(browser.received.some((m) => m.type === "approval.pending")).toBe(false);
  });

  it("supply without acceptance: open_panel is refused and tells the agent to offer first", async () => {
    const address = await start();
    const browser = await page(address);
    const agent = await mcp(address);
    const refused = await agent.callTool({ name: "open_panel", arguments: panelDoc });
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toMatch(/offer_panel/);
    expect(browser.received.some((m) => m.type === "panel.open")).toBe(false);
  });

  describe("information panels", () => {
    const READ = new Set(["get_elements", "offer_panel", "open_panel", "update_panel", "close_panel"]);
    const WRITE = new Set([...READ, "create_elements", "update_elements"]);
    /** Offers, accepts and opens a panel as an agent with these tools; returns what the page was sent. */
    async function openAs(tools: Set<string>, input: Record<string, unknown> = {}) {
      const address = await start();
      const browser = await page(address);
      const agent = await mcp(address, agentToken({ agent: "someone", tools }));
      const offered = agent.callTool({ name: "offer_panel", arguments: { purpose: "Show" } });
      browser.send("panel.offer.answer", { offerId: (await offerOf(browser)).offerId, answer: "accepted" });
      await offered;
      const opened = agent.callTool({ name: "open_panel", arguments: { ...panelDoc, ...input } });
      const sent = await panelOf(browser).then(() => browser.received.find((m) => m.type === "panel.open"));
      browser.send("panel.status", { panelId: await panelOf(browser), state: "ready" });
      await opened;
      return sent?.payload as Record<string, unknown>;
    }

    it("an agent that cannot change the model gets a read-only panel, marked by the bridge", async () => {
      expect(await openAs(READ)).toMatchObject({ readOnly: true });
    });

    it("an agent that changes the model gets an ordinary panel", async () => {
      expect(await openAs(WRITE)).not.toHaveProperty("readOnly");
    });

    it("a writer cannot ask for the mark, and a reader cannot drop it, by what it writes in the call", async () => {
      expect(await openAs(WRITE, { readOnly: true })).not.toHaveProperty("readOnly");
      expect(await openAs(READ, { readOnly: false })).toMatchObject({ readOnly: true });
    });
  });

  it("an oversized document is refused with the limit, and the accepted offer stays usable", async () => {
    const address = await start();
    const browser = await page(address);
    const agent = await mcp(address);
    const offered = agent.callTool({ name: "offer_panel", arguments: { purpose: "Tolerance" } });
    browser.send("panel.offer.answer", { offerId: (await offerOf(browser)).offerId, answer: "accepted" });
    await offered;
    const refused = await agent.callTool({
      name: "open_panel",
      arguments: { ...panelDoc, html: "a".repeat(300 * 1024) },
    });
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toMatch(/256 KB/);
    expect(browser.received.some((m) => m.type === "panel.open")).toBe(false);
    expect(bridge?.panels.stateOf(null)).toBe("accepted");
    const opened = agent.callTool({ name: "open_panel", arguments: panelDoc });
    browser.send("panel.status", { panelId: await panelOf(browser), state: "ready" });
    expect(json(await opened)).toEqual({ status: "ready" });
  });

  it("open_panel reports a document that failed to load, with the reason", async () => {
    const address = await start();
    const browser = await page(address);
    const agent = await mcp(address);
    const offered = agent.callTool({ name: "offer_panel", arguments: { purpose: "Tolerance" } });
    browser.send("panel.offer.answer", { offerId: (await offerOf(browser)).offerId, answer: "accepted" });
    await offered;
    const opened = agent.callTool({ name: "open_panel", arguments: panelDoc });
    browser.send("panel.status", {
      panelId: await panelOf(browser),
      state: "failed",
      reason: "ReferenceError: x is not defined",
    });
    const result = await opened;
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("ReferenceError: x is not defined");
  });

  it("an offer while a panel is open is refused", async () => {
    const address = await start();
    const { agent } = await openPanel(address);
    const refused = await agent.callTool({ name: "offer_panel", arguments: { purpose: "Another" } });
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toMatch(/already open/);
  });

  it("update_panel replaces the document and keeps the title and size it does not change", async () => {
    const address = await start();
    const { browser, agent, panelId } = await openPanel(address);
    const updated = agent.callTool({ name: "update_panel", arguments: { html: "<p>second</p>" } });
    const message = await browser.waitFor("panel.update");
    expect(message.payload).toMatchObject({ panelId, title: "Clearance", width: 320, html: "<p>second</p>" });
    browser.send("panel.status", { panelId, state: "ready" });
    expect(json(await updated)).toEqual({ status: "ready" });
  });

  it("close_panel closes the panel on the page; a second close finds none", async () => {
    const address = await start();
    const { browser, agent, panelId } = await openPanel(address);
    expect(json(await agent.callTool({ name: "close_panel", arguments: {} }))).toEqual({ status: "closed" });
    expect((await browser.waitFor("panel.close")).payload).toEqual({ panelId, reason: "agent" });
    expect((await agent.callTool({ name: "close_panel", arguments: {} })).isError).toBe(true);
  });

  it("switched off: none of the agent's tools is a panel tool, and an open panel is closed", async () => {
    const address = await start();
    const { browser, agent, panelId } = await openPanel(address);
    browser.send("settings.set", { features: { generatedPanels: false } });
    expect((await browser.waitFor("panel.close")).payload).toEqual({ panelId, reason: "switched-off" });
    const { tools } = await agent.listTools();
    expect(tools.map((t) => t.name).filter((n) => n.endsWith("_panel"))).toEqual([]);
    const refused = await agent
      .callTool({ name: "offer_panel", arguments: { purpose: "x" } })
      .then(textOf, (error: Error) => error.message);
    expect(refused).toMatch(/not found|unknown/i);
    expect(bridge?.panels.active).toBe(false);
  });

  it("open_panel's description documents the panel API, the styles and hand input", async () => {
    const address = await start();
    const { tools } = await (await mcp(address)).listTools();
    const description = tools.find((t) => t.name === "open_panel")?.description ?? "";
    for (const part of [
      "hai.scene.get",
      "hai.preview",
      "hai.commit",
      "hai.on(",
      "256 KB",
      "pinch",
      "<select>",
    ]) {
      expect(description).toContain(part);
    }
  });
});

describe("set_view", () => {
  it("the agent sets the view: every open page is asked to move, and the answer names what was asked", async () => {
    const address = await start();
    const browser = await connectClient(address, { token: TOKEN, origin: ORIGIN, track: sockets });
    const agent = await mcp(address);
    const result = json(
      await agent.callTool({ name: "set_view", arguments: { azimuth: 225, elevation: 30 } }),
    );
    expect(result).toMatchObject({ status: "moving", azimuth: 225, elevation: 30 });
    const asked = await browser.waitFor("view.set");
    expect(asked.payload).toMatchObject({ azimuth: 225, elevation: 30 });
  });

  it("frames elements by id", async () => {
    const address = await start();
    const browser = await connectClient(address, { token: TOKEN, origin: ORIGIN, track: sockets });
    const agent = await mcp(address);
    await agent.callTool({ name: "set_view", arguments: { frame: ["col-a1", "wall-n"] } });
    expect((await browser.waitFor("view.set")).payload.frame).toEqual(["col-a1", "wall-n"]);
  });

  it("asks for a named view, and refuses one together with a direction", async () => {
    const address = await start();
    const browser = await connectClient(address, { token: TOKEN, origin: ORIGIN, track: sockets });
    const agent = await mcp(address);
    expect(json(await agent.callTool({ name: "set_view", arguments: { view: "front" } }))).toMatchObject({
      status: "moving",
      view: "front",
    });
    expect((await browser.waitFor("view.set")).payload).toMatchObject({ view: "front" });
    const both = await agent.callTool({ name: "set_view", arguments: { view: "top", azimuth: 90 } });
    expect(both.isError).toBe(true);
    expect(textOf(both)).toMatch(/leave out azimuth and elevation/);
    expect((await agent.callTool({ name: "set_view", arguments: { view: "sideways" } })).isError).toBe(true);
  });

  it("asking for nothing, or for an impossible view, is refused", async () => {
    const address = await start();
    await connectClient(address, { token: TOKEN, origin: ORIGIN, track: sockets });
    const agent = await mcp(address);
    const nothing = await agent.callTool({ name: "set_view", arguments: {} });
    expect(nothing.isError).toBe(true);
    expect(textOf(nothing)).toMatch(/at least one/i);
    const flat = await agent.callTool({ name: "set_view", arguments: { elevation: 2 } });
    expect(flat.isError).toBe(true);
  });

  it("with no viewer open the agent is told so", async () => {
    const address = await start();
    const agent = await mcp(address);
    const result = await agent.callTool({ name: "set_view", arguments: { azimuth: 90 } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/No viewer is open/);
  });

  it("every agent has it, even one allowed no other tool", async () => {
    const address = await start();
    const reviewer = await mcp(address, agentToken({ agent: "reviewer", tools: new Set(["set_view"]) }));
    const { tools } = await reviewer.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["approve_tool", "set_view"]);
  });
});

describe("the user context in Rhino", () => {
  it("'this' in Rhino: the Rhino object under the pointer, and the Rhino selection, with their layers", async () => {
    const { connectFakeRhino, rhinoBatch, rhinoObject } = await import("../../test/rhino-client.ts");
    const address = await start();
    const browser = await connectClient(address, { token: TOKEN, origin: ORIGIN, track: sockets });
    const rhino = await connectFakeRhino(address, { token: TOKEN, track: sockets });
    const asset = await rhino.uploadMesh();
    rhino.send(
      "rhino.objects",
      rhinoBatch({
        reset: true,
        changed: [
          rhinoObject("brep-1", asset, {
            name: "Facade panel",
            layer: "Facade",
            tags: { "hai.owner": "architect" },
          }),
        ],
      }),
    );
    await browser.waitFor("rhino.objects");
    rhino.send("rhino.selection", { objects: [{ id: "brep-1", type: "Brep", layer: "Facade" }] });
    await browser.waitFor("rhino.selection");
    browser.send("context.update", { pointed: "brep-1", camera: null });
    const agent = await mcp(address);
    await expect
      .poll(
        async () =>
          json(await agent.callTool({ name: "get_user_context", arguments: {} })).rhino?.pointed?.id,
      )
      .toBe("brep-1");
    const context = json(await agent.callTool({ name: "get_user_context", arguments: {} }));
    expect(context.rhino.pointed).toEqual({
      id: "brep-1",
      name: "Facade panel",
      type: "brep",
      layer: "Facade",
      tags: { "hai.owner": "architect" },
    });
    expect(context.rhino.selection).toEqual([{ id: "brep-1", type: "Brep", layer: "Facade" }]);
  });

  it("without Rhino the context has no Rhino part", async () => {
    const address = await start();
    const agent = await mcp(address);
    expect(json(await agent.callTool({ name: "get_user_context", arguments: {} })).rhino).toBeUndefined();
  });
});

describe("reading the model by owner, part and tag", () => {
  const column = (id: string, tags: Record<string, string>): Element => ({
    id,
    name: id,
    type: "column",
    properties: {},
    position: [0, 0],
    section: [400, 400],
    height: 3000,
    tags,
  });
  const seed = (): void => {
    bridge?.scene.scene.apply("seed", [
      { op: "create", element: column("g-1", { "hai.owner": "architect", "hai.part": "garden" }) },
      {
        op: "create",
        element: column("g-2", { "hai.owner": "architect", "hai.part": "garden", mood: "calm" }),
      },
      { op: "create", element: column("h-1", { "hai.owner": "product", "hai.part": "hall" }) },
      { op: "create", element: column("free-1", {}) },
    ]);
  };

  it("filter by part, owner and tag returns only those elements, with their tags", async () => {
    const address = await start();
    seed();
    const agent = await mcp(address);
    const ids = async (arguments_: Record<string, unknown>) =>
      (json(await agent.callTool({ name: "get_elements", arguments: arguments_ })).elements as Element[])
        .map((e) => e.id)
        .sort();
    expect(await ids({ part: "garden" })).toEqual(["g-1", "g-2"]);
    expect(await ids({ owner: "product" })).toEqual(["h-1"]);
    expect(await ids({ tag: { name: "mood" } })).toEqual(["g-2"]);
    expect(await ids({ tag: { name: "mood", value: "wild" } })).toEqual([]);
    expect(await ids({ owner: "architect", part: "hall" })).toEqual([]);
    const garden = json(await agent.callTool({ name: "get_elements", arguments: { part: "garden" } }));
    expect(garden.elements[0].tags).toMatchObject({ "hai.part": "garden" });
  });

  it("the summary counts the elements each owner and part holds, and those with none", async () => {
    const address = await start();
    seed();
    const summary = json(await (await mcp(address)).callTool({ name: "get_scene_summary", arguments: {} }));
    expect(summary.owners).toEqual({ architect: 2, product: 1 });
    expect(summary.parts).toEqual({ garden: 2, hall: 1 });
    // The sample scene's own elements and the free column have no owner.
    expect(summary.withoutOwner).toBeGreaterThanOrEqual(1);
    expect(summary.rhino).toBeUndefined();
  });

  it("while Rhino is connected one question returns both the elements and the Rhino objects", async () => {
    const { connectFakeRhino, rhinoBatch, rhinoObject } = await import("../../test/rhino-client.ts");
    const address = await start();
    seed();
    const browser = await connectClient(address, { token: TOKEN, origin: ORIGIN, track: sockets });
    const rhino = await connectFakeRhino(address, { token: TOKEN, track: sockets });
    const asset = await rhino.uploadMesh();
    rhino.send(
      "rhino.objects",
      rhinoBatch({
        reset: true,
        changed: [
          rhinoObject("r-1", asset, {
            name: "Pond",
            tags: { "hai.owner": "architect", "hai.part": "garden" },
          }),
          rhinoObject("r-2", asset, {
            name: "Hall roof",
            tags: { "hai.owner": "product", "hai.part": "hall" },
          }),
        ],
      }),
    );
    await browser.waitFor("rhino.objects");
    const agent = await mcp(address);
    await expect
      .poll(
        async () => json(await agent.callTool({ name: "get_scene_summary", arguments: {} })).rhino?.objects,
      )
      .toBe(2);
    const found = json(await agent.callTool({ name: "get_elements", arguments: { part: "garden" } }));
    expect(found.elements.map((e: Element) => e.id).sort()).toEqual(["g-1", "g-2"]);
    expect(found.rhinoObjects).toEqual([
      {
        id: "r-1",
        name: "Pond",
        type: "brep",
        layer: "Default",
        tags: { "hai.owner": "architect", "hai.part": "garden" },
      },
    ]);
    const summary = json(await agent.callTool({ name: "get_scene_summary", arguments: {} }));
    expect(summary.rhino).toEqual({
      objects: 2,
      owners: { architect: 1, product: 1 },
      parts: { garden: 1, hall: 1 },
    });
  });
});

describe("transform_elements", () => {
  it("moves, turns and scales elements in one change, whatever their type", async () => {
    const address = await start();
    const agent = await mcp(address);
    const before = json(await agent.callTool({ name: "get_elements", arguments: { ids: ["block-b"] } }))
      .elements[0];
    const moved = await agent.callTool({
      name: "transform_elements",
      arguments: {
        ids: ["block-b"],
        steps: [
          { kind: "translate", by: [1000, 2000] },
          { kind: "rotate", deg: 90 },
        ],
      },
    });
    expect(moved.isError).toBeFalsy();
    const after = json(await agent.callTool({ name: "get_elements", arguments: { ids: ["block-b"] } }))
      .elements[0];
    expect(after.rotationDeg).toBe(90);
    // The box was moved and then turned about its own centre, so its centre is where the move put it.
    type Box = { origin: [number, number, number]; size: [number, number, number] };
    const centre = (e: Box): [number, number] => [e.origin[0] + e.size[0] / 2, e.origin[1] + e.size[1] / 2];
    const [bx, by] = centre(before);
    const [ax, ay] = centre(after);
    expect(ax).toBeCloseTo(bx + 1000, 6);
    expect(ay).toBeCloseTo(by + 2000, 6);
  });

  it("makes copies, each put through the steps once more than the one before, and keeps the original", async () => {
    const address = await start();
    const agent = await mcp(address);
    const result = json(
      await agent.callTool({
        name: "transform_elements",
        arguments: { ids: ["block-b"], steps: [{ kind: "translate", by: [0, 6000] }], copies: 3 },
      }),
    );
    expect(result.created).toHaveLength(3);
    const original = json(await agent.callTool({ name: "get_elements", arguments: { ids: ["block-b"] } }))
      .elements[0];
    const copies = json(
      await agent.callTool({ name: "get_elements", arguments: { ids: result.created } }),
    ).elements;
    expect(
      copies.map((c: { origin: number[] }) => (c.origin[1] ?? 0) - (original.origin[1] as number)),
    ).toEqual([6000, 12000, 18000]);
    expect(
      json(await agent.callTool({ name: "get_elements", arguments: { ids: ["block-b"] } })).elements[0],
    ).toEqual(original);
  });

  it("changes nothing when an id is unknown", async () => {
    const address = await start();
    const agent = await mcp(address);
    const refused = await agent.callTool({
      name: "transform_elements",
      arguments: { ids: ["block-b", "nope"], steps: [{ kind: "translate", by: [1, 1] }] },
    });
    expect(refused.isError).toBe(true);
  });
});
