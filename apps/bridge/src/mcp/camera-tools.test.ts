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
const TOKEN = "camera-test-token-0123456789";
const CAMERA_TOOLS = new Set([
  "camera_set",
  "camera_list",
  "camera_capture",
  "camera_delete",
  "get_elements",
]);
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
  const projectDir = join(mkdtempSync(join(tmpdir(), "hai-cam-")), "project");
  bridge = createBridge({
    host: "127.0.0.1",
    port: 0,
    allowedOrigins: [ORIGIN],
    version: "t",
    token: TOKEN,
    mirrorDir: join(mkdtempSync(join(tmpdir(), "hai-cam-mirror-")), "mirror"),
    scene: { projectDir, saveDelayMs: 50 },
  });
  return bridge.start();
}

/** An MCP client as the named agent would be one. */
async function agent(address: AddressInfo, name: string) {
  const token = bridge?.agentTokens.issue({ agent: name, tools: CAMERA_TOOLS });
  const client = new Client({ name, version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  clients.push(client);
  return client;
}

const textOf = (result: { content?: unknown }) =>
  (result.content as Array<{ text?: string }> | undefined)?.[0]?.text ?? "";
const json = (result: { content?: unknown }) => JSON.parse(textOf(result));

describe("agent cameras", () => {
  it("places a camera of its own without moving the user's view, and other agents do not see it", async () => {
    const address = await start();
    const viewer = await connectClient(address, { token: TOKEN, origin: ORIGIN, track: sockets });
    const architect = await agent(address, "architect");
    const product = await agent(address, "product");

    const placed = json(
      await architect.callTool({
        name: "camera_set",
        arguments: { name: "south", azimuth: 270, elevation: 30, distance: 20000, target: [0, 0, 0] },
      }),
    );
    expect(placed).toMatchObject({
      status: "placed",
      camera: { name: "south", azimuth: 270, distance: 20000 },
    });
    expect(json(await architect.callTool({ name: "camera_list", arguments: {} })).cameras).toHaveLength(1);
    expect(json(await product.callTool({ name: "camera_list", arguments: {} })).cameras).toEqual([]);
    // The same name is free for another agent.
    await product.callTool({ name: "camera_set", arguments: { name: "south", azimuth: 90 } });
    expect(json(await architect.callTool({ name: "camera_list", arguments: {} })).cameras[0].azimuth).toBe(
      270,
    );
    // Nothing was sent to the user's viewer to move its camera.
    expect(viewer.received.some((m) => m.type === "view.set")).toBe(false);
  });

  it("refuses a ninth camera, a missing frame target, and a camera it does not have", async () => {
    const address = await start();
    const architect = await agent(address, "architect");
    for (let i = 0; i < 8; i++) {
      const ok = await architect.callTool({
        name: "camera_set",
        arguments: { name: `c${i}`, azimuth: i * 10 },
      });
      expect(ok.isError).not.toBe(true);
    }
    const ninth = await architect.callTool({ name: "camera_set", arguments: { name: "c9", azimuth: 5 } });
    expect(ninth.isError).toBe(true);
    expect(textOf(ninth)).toMatch(/8 cameras/);
    // Moving an existing camera is still fine.
    const moved = await architect.callTool({ name: "camera_set", arguments: { name: "c0", azimuth: 99 } });
    expect(moved.isError).not.toBe(true);
    const frame = await architect.callTool({
      name: "camera_set",
      arguments: { name: "c0", frame: ["nope"] },
    });
    expect(textOf(frame)).toMatch(/No element with the id "nope"/);
    const missing = await architect.callTool({ name: "camera_capture", arguments: { cameras: ["ghost"] } });
    expect(textOf(missing)).toMatch(/no camera named "ghost"/);
    const bad = await architect.callTool({ name: "camera_set", arguments: { name: "x", elevation: 2 } });
    expect(bad.isError).toBe(true);
  });

  it("captures from its cameras through one viewer only, naming the agent", async () => {
    const address = await start();
    const first = await connectClient(address, { token: TOKEN, origin: ORIGIN, track: sockets });
    const second = await connectClient(address, { token: TOKEN, origin: ORIGIN, track: sockets });
    // The user last used the second window.
    second.send("context.update", { pointed: null, camera: null });
    await new Promise((r) => setTimeout(r, 50));
    const architect = await agent(address, "architect");
    await architect.callTool({ name: "camera_set", arguments: { name: "south", azimuth: 270 } });
    const result = architect.callTool({
      name: "camera_capture",
      arguments: { cameras: ["south"], size: 512 },
    });
    const request = await second.waitFor("view.capture");
    expect(request.payload).toMatchObject({ agent: "architect", size: 512, cameras: [{ name: "south" }] });
    expect(request.payload.options).toEqual({ section: false, selection: false });
    expect(first.received.some((m) => m.type === "view.capture")).toBe(false);
    second.send("view.captured", {
      requestId: request.payload.requestId,
      shots: [{ camera: "south", png: "iVBORw0KGgo=", thumb: "data:image/jpeg;base64,/9j/" }],
    });
    const content = ((await result) as { content: Array<{ type: string; text?: string; data?: string }> })
      .content;
    expect(content[0]?.text).toMatch(/^south: from the s,/);
    expect(content[1]).toMatchObject({ type: "image", data: "iVBORw0KGgo=" });
    // The last picture is on the team's snapshot for the strip.
    await new Promise((r) => setTimeout(r, 50));
    expect(bridge?.eyes.snapshot().shots).toMatchObject([{ agent: "architect", camera: "south" }]);
  });

  it("a preset takes pictures from cameras it makes, without keeping them", async () => {
    const address = await start();
    const viewer = await connectClient(address, { token: TOKEN, origin: ORIGIN, track: sockets });
    const architect = await agent(address, "architect");
    const result = architect.callTool({ name: "camera_capture", arguments: { preset: "orbit-sheet" } });
    const request = await viewer.waitFor("view.capture");
    const names = request.payload.cameras?.map((c) => c.name);
    expect(names).toHaveLength(8);
    expect(new Set(names).size).toBe(8);
    expect(request.payload.size).toBe(640);
    viewer.send("view.captured", {
      requestId: request.payload.requestId,
      shots: (names ?? []).map((camera) => ({
        camera,
        png: "iVBORw0KGgo=",
        thumb: "data:image/jpeg;base64,/9j/",
      })),
    });
    const content = ((await result) as { content: Array<{ type: string }> }).content;
    expect(content.filter((c) => c.type === "image")).toHaveLength(8);
    expect(json(await architect.callTool({ name: "camera_list", arguments: {} })).cameras).toEqual([]);
  });

  it("reports that no viewer is open, and that a viewer that does not answer timed out", async () => {
    const address = await start();
    const architect = await agent(address, "architect");
    const none = await architect.callTool({ name: "camera_capture", arguments: { preset: "top" } });
    expect(textOf(none)).toMatch(/No viewer is open/);
    const both = await architect.callTool({
      name: "camera_capture",
      arguments: { preset: "top", cameras: ["a"] },
    });
    expect(textOf(both)).toMatch(/not both/);
  });

  it("an agent's cameras go when its task ends, and all of them when the project changes", async () => {
    const address = await start();
    const architect = await agent(address, "architect");
    await architect.callTool({ name: "camera_set", arguments: { name: "south" } });
    expect(bridge?.eyes.snapshot().cameras).toHaveLength(1);
    bridge?.eyes.clear("architect");
    expect(bridge?.eyes.snapshot().cameras).toEqual([]);
    expect(json(await architect.callTool({ name: "camera_list", arguments: {} })).cameras).toEqual([]);
  });
});
