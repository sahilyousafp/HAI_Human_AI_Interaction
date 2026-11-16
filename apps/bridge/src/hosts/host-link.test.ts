import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type HostId, TOKEN_PROTOCOL_PREFIX, WS_PATH, WS_PROTOCOL } from "@hai/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { connectFakeHost, hostBatch, hostObject } from "../../test/host-client.ts";
import { connectClient } from "../../test/ws-client.ts";
import {
  discoveryFilePath,
  readDiscoveryFile,
  removeDiscoveryFile,
  writeDiscoveryFile,
} from "../discovery-file.ts";
import { type Bridge, createBridge } from "../server.ts";

const ORIGIN = "http://localhost:5173";
const TOKEN = "host-test-token-0123456789";
const temp = (prefix: string) => mkdtempSync(join(tmpdir(), prefix));

let bridge: Bridge | null = null;
let address: AddressInfo;
const sockets: WebSocket[] = [];
let mirrorDir = "";

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.close();
  await bridge?.stop();
  bridge = null;
});

async function start() {
  mirrorDir = temp("hai-mirror-");
  bridge = createBridge({
    host: "127.0.0.1",
    port: 0,
    allowedOrigins: [ORIGIN],
    version: "t",
    token: TOKEN,
    mirrorDir,
    describeDelayMs: 20,
    scene: { projectDir: join(temp("hai-host-"), "project"), saveDelayMs: 50 },
  });
  address = await bridge.start();
  return bridge;
}

const link = (host: HostId = "rhino") => {
  if (!bridge) throw new Error("no bridge");
  return bridge.hosts.get(host);
};
const page = () => connectClient(address, { token: TOKEN, origin: ORIGIN, track: sockets });
const hostClient = (options: Partial<Parameters<typeof connectFakeHost>[1]> = {}) =>
  connectFakeHost(address, { token: TOKEN, track: sockets, ...options });
const mirrorFile = (asset: string, host: HostId = "rhino") =>
  join(mirrorDir, host, "assets", `${asset}.haimesh`);

/** Resolves with the HTTP status of a refused upgrade, or "open" if it was accepted. */
function outcome(opts: { token?: string; origin?: string }): Promise<number | "open"> {
  const protocols = [WS_PROTOCOL, ...(opts.token ? [`${TOKEN_PROTOCOL_PREFIX}${opts.token}`] : [])];
  const ws = new WebSocket(`ws://127.0.0.1:${address.port}${WS_PATH}`, protocols, {
    headers: opts.origin ? { origin: opts.origin } : {},
  });
  sockets.push(ws);
  return new Promise((resolve) => {
    ws.once("open", () => resolve("open"));
    ws.once("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
    ws.once("error", () => {});
  });
}

/** A local connection that has not said hello yet. */
async function rawLocal(): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${address.port}${WS_PATH}`, [
    WS_PROTOCOL,
    `${TOKEN_PROTOCOL_PREFIX}${TOKEN}`,
  ]);
  sockets.push(ws);
  await new Promise((r) => ws.once("open", r));
  return ws;
}

describe("who may connect as a host", () => {
  it("a local program with the token and no Origin is accepted as the host it names", async () => {
    await start();
    const rhino = await hostClient();
    expect(rhino.received.some((m) => m.type === "bridge.status")).toBe(true);
    expect(link().connected).toBe(true);
    // It is not a page: the client count does not include it.
    expect((await rhino.waitFor("bridge.status")).payload.clients).toBe(0);
  });

  it("any host id connects with the token", async () => {
    await start();
    await hostClient({ host: "blender" });
    expect(link("blender").connected).toBe(true);
    expect(link("blender").app).toEqual({ name: "Blender", version: "5.1.0" });
    expect(link("rhino").connected).toBe(false);
  });

  it("an old plugin is refused: it is told to update, and the bridge does not count it as connected", async () => {
    await start();
    const browser = await page();
    const old = await rawLocal();
    const answers: string[] = [];
    old.on("message", (d) => answers.push(d.toString()));
    const closed = new Promise<number>((r) => old.once("close", (code) => r(code)));
    old.send(
      JSON.stringify({
        type: "hello",
        id: "h",
        payload: {
          client: "rhino",
          protocolVersion: 1,
          rhinoVersion: "8.36",
          pluginVersion: "0.1.0",
          python: { state: "ready" },
          document: null,
        },
      }),
    );
    expect(await closed).toBe(1008);
    const refused = answers.map((a) => JSON.parse(a)).find((m) => m.type === "host.refused");
    expect(refused?.payload.reason).toMatch(/HAI for Rhino is older than the bridge: install the new one/);
    expect(link().connected).toBe(false);
    expect(
      browser.received.some(
        (m) => m.type === "host.state" && m.payload.host === "rhino" && m.payload.connected,
      ),
    ).toBe(false);
  });

  it("token-less local client rejected", async () => {
    await start();
    expect(await outcome({})).toBe(401);
    expect(await outcome({ token: "wrong-token-0123456789" })).toBe(401);
  });

  it("a foreign origin is still refused, with the right token", async () => {
    await start();
    expect(await outcome({ token: TOKEN, origin: "https://evil.example" })).toBe(403);
  });

  it("a web page cannot say hello as a host, and a local program cannot say hello as a page", async () => {
    await start();
    const asPage = new WebSocket(
      `ws://127.0.0.1:${address.port}${WS_PATH}`,
      [WS_PROTOCOL, `${TOKEN_PROTOCOL_PREFIX}${TOKEN}`],
      { headers: { origin: ORIGIN } },
    );
    sockets.push(asPage);
    await new Promise((r) => asPage.once("open", r));
    const closedPage = new Promise<number>((r) => asPage.once("close", (code) => r(code)));
    asPage.send(
      JSON.stringify({
        type: "hello",
        id: "h",
        payload: {
          client: "rhino",
          protocolVersion: 2,
          app: { name: "Rhino 8", version: "8" },
          connectorVersion: "1",
          run: { state: "ready" },
          document: null,
          capabilities: {
            languages: ["python"],
            capture: true,
            placeImage: true,
            apiLookup: true,
            describe: true,
          },
        },
      }),
    );
    expect(await closedPage).toBe(1008);

    const asLocal = await rawLocal();
    const closedLocal = new Promise<number>((r) => asLocal.once("close", (code) => r(code)));
    asLocal.send(JSON.stringify({ type: "hello", id: "h", payload: { client: "web", protocolVersion: 2 } }));
    expect(await closedLocal).toBe(1008);
    expect(link().connected).toBe(false);
  });

  it("a connector may report on its own host and nothing else", async () => {
    await start();
    const rhino = await hostClient();
    const closed = new Promise<number>((r) => rhino.ws.once("close", (code) => r(code)));
    rhino.send("scene.apply", { label: "x", ops: [{ op: "delete", id: "wall-n" }] });
    expect(await closed).toBe(1008);
    expect(bridge?.scene.scene.doc.elements["wall-n"]).toBeDefined();

    // Nor may it speak for another host.
    const blender = await hostClient({ host: "blender" });
    const closedBlender = new Promise<number>((r) => blender.ws.once("close", (code) => r(code)));
    blender.send("host.status", { host: "rhino", run: { state: "ready" }, document: "spoofed.3dm" });
    expect(await closedBlender).toBe(1008);
  });

  it("a second connection of the same host replaces the first", async () => {
    await start();
    const first = await hostClient();
    const closed = new Promise<number>((r) => first.ws.once("close", (code) => r(code)));
    await hostClient();
    expect(await closed).toBe(1000);
    expect(link().connected).toBe(true);
  });
});

describe("the discovery file", () => {
  it("Discovery file lifecycle: it holds the port and token while the bridge runs and is gone after", () => {
    const file = join(temp("hai-discovery-"), "HAI", "bridge.json");
    const own = { pid: 4242, token: "tok-1" };
    const { warning } = writeDiscoveryFile(file, {
      port: 4711,
      startedAt: "2026-10-24T10:00:00.000Z",
      ...own,
    });
    expect(warning).toBeNull();
    expect(readDiscoveryFile(file)).toMatchObject({ port: 4711, token: "tok-1", pid: 4242 });
    removeDiscoveryFile(file, own);
    expect(existsSync(file)).toBe(false);
  });

  it("a newer bridge's file is not removed by an older one shutting down", () => {
    const file = join(temp("hai-discovery-"), "bridge.json");
    writeDiscoveryFile(file, { port: 1, token: "old", pid: 1, startedAt: "x" });
    writeDiscoveryFile(file, { port: 2, token: "new", pid: 2, startedAt: "y" });
    removeDiscoveryFile(file, { pid: 1, token: "old" });
    expect(readDiscoveryFile(file)?.token).toBe("new");
  });

  it.runIf(process.platform === "win32")("on Windows only the current user may read it", async () => {
    const { execFileSync } = await import("node:child_process");
    const file = join(temp("hai-discovery-"), "bridge.json");
    writeDiscoveryFile(file, { port: 1, token: "t", pid: 1, startedAt: "x" });
    const acl = execFileSync("icacls", [file], { encoding: "utf8" });
    expect(acl).not.toMatch(/Everyone|BUILTIN\\Users|Authenticated Users/);
    expect(acl).toContain(process.env.USERNAME ?? "");
  });

  it("is under the user's local application data, or the file HAI_DISCOVERY_FILE names", () => {
    expect(discoveryFilePath({ LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local" })).toMatch(
      /AppData.Local.HAI.bridge\.json$/,
    );
    expect(discoveryFilePath({ HAI_DISCOVERY_FILE: "D:\\x\\y.json" })).toBe("D:\\x\\y.json");
  });

  it("holds a token that works for a connector", async () => {
    await start();
    const file = join(temp("hai-discovery-"), "bridge.json");
    writeDiscoveryFile(file, { port: address.port, token: TOKEN, pid: process.pid, startedAt: "x" });
    const info = JSON.parse(readFileSync(file, "utf8"));
    const rhino = await connectFakeHost(
      { ...address, port: info.port },
      { token: info.token, track: sockets },
    );
    expect(rhino.received.some((m) => m.type === "bridge.status")).toBe(true);
  });
});

describe("the mirror", () => {
  it("a block's placements share one mesh: it stays until the last of them goes, also when one is replaced", async () => {
    await start();
    const rhino = await hostClient();
    const asset = await rhino.uploadMesh();
    const placement = (id: string, x: number) =>
      hostObject(id, asset, { type: "block", transform: [1, 0, 0, x, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] });
    const held = () =>
      link()
        .mirroredObjects.map((o) => o.id)
        .sort();

    rhino.send(
      "host.objects",
      hostBatch({ reset: true, changed: [placement("a", 0), placement("b", 5000)] }),
    );
    await expect.poll(held).toEqual(["a", "b"]);
    // One goes: the other still draws it.
    rhino.send("host.objects", hostBatch({ deleted: ["a"] }));
    await expect.poll(held).toEqual(["b"]);
    expect(existsSync(mirrorFile(asset))).toBe(true);
    // The only one left is moved, naming the mesh it already has: this must not lose it.
    rhino.send("host.objects", hostBatch({ changed: [placement("b", 9000)] }));
    await expect.poll(() => link().object("b")?.transform?.[3]).toBe(9000);
    expect(existsSync(mirrorFile(asset))).toBe(true);
    rhino.send("host.objects", hostBatch({ deleted: ["b"] }));
    await expect.poll(held).toEqual([]);
    await expect.poll(() => existsSync(mirrorFile(asset))).toBe(false);
  });

  it("the mirror reaches a late page, and a change reaches a page already open", async () => {
    await start();
    const rhino = await hostClient();
    const early = await page();
    const asset = await rhino.uploadMesh();
    rhino.send("host.objects", hostBatch({ reset: true, changed: [hostObject("a1", asset)] }));
    const live = await early.waitFor("host.objects");
    expect(live.payload.host).toBe("rhino");
    expect(live.payload.changed.map((o) => o.id)).toEqual(["a1"]);

    const late = await page();
    const state = await late.waitFor(
      "host.state",
      (m) => m.payload.host === "rhino" && m.payload.objects.length === 1,
    );
    expect(state.payload).toMatchObject({ connected: true, switchedOn: true, app: { name: "Rhino 8" } });
    expect(state.payload.objects[0]?.id).toBe("a1");
    // Every host is described to the page, connected or not.
    for (const host of ["blender", "revit"] as const)
      await late.waitFor("host.state", (m) => m.payload.host === host && !m.payload.connected);
  });

  it("two hosts at once: each keeps its own objects and meshes, and one going away leaves the other", async () => {
    await start();
    const rhino = await hostClient();
    const blender = await hostClient({ host: "blender" });
    const early = await page();
    const a = await rhino.uploadMesh();
    const b = await blender.uploadMesh();
    rhino.send("host.objects", hostBatch({ reset: true, changed: [hostObject("r1", a)] }));
    blender.send(
      "host.objects",
      hostBatch({ reset: true, changed: [hostObject("b1", b, { type: "object" })] }),
    );
    await early.waitFor("host.objects", (m) => m.payload.host === "rhino");
    await early.waitFor("host.objects", (m) => m.payload.host === "blender");
    expect(bridge?.hosts.mirroredObjects.map((o) => `${o.host}:${o.id}`).sort()).toEqual([
      "blender:b1",
      "rhino:r1",
    ]);
    expect(bridge?.hosts.object("b1")?.host).toBe("blender");
    expect(existsSync(mirrorFile(a, "rhino"))).toBe(true);
    expect(existsSync(mirrorFile(b, "blender"))).toBe(true);

    rhino.ws.close();
    await early.waitFor("host.state", (m) => m.payload.host === "rhino" && !m.payload.connected);
    expect(existsSync(mirrorFile(a, "rhino"))).toBe(false);
    expect(existsSync(mirrorFile(b, "blender"))).toBe(true);
    expect(bridge?.hosts.mirroredObjects.map((o) => o.id)).toEqual(["b1"]);
  });

  it("a moved, replaced and deleted object follow, and a replaced mesh is dropped from disk", async () => {
    await start();
    const rhino = await hostClient();
    const early = await page();
    const first = await rhino.uploadMesh();
    rhino.send("host.objects", hostBatch({ reset: true, changed: [hostObject("a1", first)] }));
    await early.waitFor("host.objects");
    expect(existsSync(mirrorFile(first))).toBe(true);

    const second = await rhino.uploadMesh(2000);
    rhino.send("host.objects", hostBatch({ changed: [hostObject("a1", second)] }));
    await early.waitFor("host.objects", (m) => m.payload.changed[0]?.asset === second);
    expect(existsSync(mirrorFile(first))).toBe(false);
    expect(existsSync(mirrorFile(second))).toBe(true);

    rhino.send("host.objects", hostBatch({ deleted: ["a1"] }));
    await early.waitFor("host.objects", (m) => m.payload.deleted.includes("a1"));
    expect(existsSync(mirrorFile(second))).toBe(false);
    expect(link().object("a1")).toBeUndefined();
  });

  it("an asset is uploaded before its descriptor: an object whose mesh is missing is not forwarded", async () => {
    await start();
    const rhino = await hostClient();
    const early = await page();
    const real = await rhino.uploadMesh();
    const never = "11111111-2222-4333-8444-555555555555";
    rhino.send(
      "host.objects",
      hostBatch({ reset: true, changed: [hostObject("ok", real), hostObject("ghost", never)] }),
    );
    const batch = await early.waitFor("host.objects");
    expect(batch.payload.changed.map((o) => o.id)).toEqual(["ok"]);
    expect(link().object("ghost")).toBeUndefined();
  });

  it("a mesh in another host's store does not count: each host names only its own meshes", async () => {
    await start();
    const rhino = await hostClient();
    const blender = await hostClient({ host: "blender" });
    const early = await page();
    const blenders = await blender.uploadMesh();
    const own = await rhino.uploadMesh();
    rhino.send(
      "host.objects",
      hostBatch({ reset: true, changed: [hostObject("x", blenders), hostObject("y", own)] }),
    );
    const batch = await early.waitFor("host.objects", (m) => m.payload.host === "rhino");
    expect(batch.payload.changed.map((o) => o.id)).toEqual(["y"]);
  });

  it("an object drawn as its box (too heavy) has no asset and is forwarded", async () => {
    await start();
    const rhino = await hostClient();
    const early = await page();
    rhino.send(
      "host.objects",
      hostBatch({
        reset: true,
        changed: [hostObject("big", null)],
        notDrawn: { curves: 12, points: 0, annotations: 1, other: 0, heavy: 1, simplified: 0 },
      }),
    );
    const batch = await early.waitFor("host.objects");
    expect(batch.payload.changed[0]?.asset).toBeNull();
    expect(batch.payload.notDrawn).toMatchObject({ curves: 12, heavy: 1 });
  });

  it("the first sync reports progress, and a reset replaces what was held", async () => {
    await start();
    const rhino = await hostClient();
    const early = await page();
    const a = await rhino.uploadMesh();
    rhino.send(
      "host.objects",
      hostBatch({ reset: true, sync: { done: 1, total: 3 }, changed: [hostObject("a", a)] }),
    );
    expect((await early.waitFor("host.objects")).payload.sync).toEqual({ done: 1, total: 3 });
    const b = await rhino.uploadMesh();
    rhino.send("host.objects", hostBatch({ reset: true, changed: [hostObject("b", b)] }));
    await early.waitFor("host.objects", (m) => m.payload.changed[0]?.id === "b");
    expect(link().object("a")).toBeUndefined();
    expect(existsSync(mirrorFile(a))).toBe(false);
  });

  it("a host disconnects: pages are told, and its meshes are removed", async () => {
    await start();
    const rhino = await hostClient();
    const early = await page();
    const asset = await rhino.uploadMesh();
    rhino.send("host.objects", hostBatch({ reset: true, changed: [hostObject("a1", asset)] }));
    await early.waitFor("host.objects");
    rhino.ws.close();
    const cleared = await early.waitFor(
      "host.state",
      (m) => m.payload.host === "rhino" && !m.payload.connected,
    );
    expect(cleared.payload).toMatchObject({ connected: false, app: null, run: null, objects: [] });
    expect(existsSync(mirrorFile(asset))).toBe(false);
  });

  it("meshes live apart from the project: they are not in the project's assets folder", async () => {
    await start();
    const rhino = await hostClient();
    const asset = await rhino.uploadMesh();
    const projectDir = bridge?.scene.projectDir ?? "";
    expect(existsSync(join(projectDir, "assets", `${asset}.haimesh`))).toBe(false);
    expect(existsSync(mirrorFile(asset))).toBe(true);
    const res = await fetch(`http://127.0.0.1:${address.port}/assets/${asset}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(404);
  });

  it("a mesh upload needs the token and a known host", async () => {
    await start();
    const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
    const put = (path: string, auth = true) =>
      fetch(`http://127.0.0.1:${address.port}${path}`, {
        method: "PUT",
        headers: auth ? { authorization: `Bearer ${TOKEN}` } : {},
        body: new Uint8Array(20),
      });
    expect((await put(`/mirror/rhino/${id}`, false)).status).toBe(401);
    expect((await put(`/mirror/sketchup/${id}`)).status).toBe(404);
    expect((await put(`/mirror/${id}`)).status).toBe(404);
  });
});

describe("selection both ways", () => {
  it("mouse selection mirrored: a host's selection reaches the bridge and the pages", async () => {
    await start();
    const rhino = await hostClient();
    const early = await page();
    const asset = await rhino.uploadMesh();
    rhino.send(
      "host.objects",
      hostBatch({ reset: true, changed: [hostObject("a1", asset), hostObject("a2", asset)] }),
    );
    await early.waitFor("host.objects");
    rhino.send("host.selection", {
      objects: [
        { id: "a1", type: "Brep", layer: "Facade" },
        { id: "a2", type: "Brep", layer: "Facade" },
      ],
    });
    const seen = await early.waitFor("host.selection");
    expect(seen.payload).toMatchObject({ host: "rhino" });
    expect(seen.payload.objects.map((o) => o.id)).toEqual(["a1", "a2"]);
    expect(link().selection.map((s) => s.id)).toEqual(["a1", "a2"]);
  });

  it("a pick selects in its own host, and clears the other hosts' selections", async () => {
    await start();
    const rhino = await hostClient();
    const blender = await hostClient({ host: "blender" });
    const early = await page();
    blender.send("host.selection", { objects: [{ id: "b1", type: "MESH", layer: "Scene" }] });
    await expect.poll(() => link("blender").selection.length).toBe(1);
    early.send("host.select", { host: "rhino", ids: ["a1"] });
    expect((await rhino.waitFor("host.select")).payload.ids).toEqual(["a1"]);
    expect((await blender.waitFor("host.select")).payload.ids).toEqual([]);
    // A tap on empty space clears every host.
    early.send("host.select", { host: "rhino", ids: [] });
    await rhino.waitFor("host.select", (m) => m.payload.ids.length === 0);
  });

  it("with no host connected a pick goes nowhere and breaks nothing", async () => {
    await start();
    const early = await page();
    early.send("host.select", { host: "rhino", ids: ["a1"] });
    await new Promise((r) => setTimeout(r, 50));
    expect(early.ws.readyState).toBe(WebSocket.OPEN);
  });
});

describe("selected components describe themselves", () => {
  const component = (id: string) => ({
    id,
    name: "Canopy",
    type: "Closed Brep",
    layer: "Roof",
    bounds: { min: [0, 0, 0], max: [6000, 6000, 900] },
    quantities: { volumeMm3: 3.24e10 },
    material: "Timber",
    properties: { "hai.part": "canopy" },
  });

  it("a selected Brep is described: the bridge asks once the selection settles, and pages get the components", async () => {
    await start();
    const rhino = await hostClient();
    const early = await page();
    rhino.send("host.selection", { objects: [{ id: "a1", type: "Brep", layer: "Roof" }] });
    const asked = await rhino.waitFor("host.describe");
    expect(asked.payload.ids).toEqual(["a1"]);
    rhino.send("host.described", { id: asked.payload.id, components: [component("a1")] });
    const seen = await early.waitFor("host.selection", (m) => (m.payload.components?.length ?? 0) === 1);
    expect(seen.payload.components?.[0]).toMatchObject({
      material: "Timber",
      quantities: { volumeMm3: 3.24e10 },
      properties: { "hai.part": "canopy" },
    });
    expect(link().components.map((c) => c.id)).toEqual(["a1"]);
  });

  it("a description of a selection that has since changed is dropped", async () => {
    await start();
    const rhino = await hostClient();
    rhino.send("host.selection", { objects: [{ id: "a1", type: "Brep", layer: "Roof" }] });
    const first = await rhino.waitFor("host.describe");
    rhino.send("host.selection", { objects: [{ id: "a2", type: "Brep", layer: "Roof" }] });
    await rhino.waitFor("host.describe", (m) => m.payload.ids[0] === "a2");
    rhino.send("host.described", { id: first.payload.id, components: [component("a1")] });
    await new Promise((r) => setTimeout(r, 50));
    expect(link().components).toEqual([]);
  });

  it("a request knows what 'this' is: a request made while something is selected carries the components", async () => {
    await start();
    const rhino = await hostClient();
    rhino.send("host.selection", { objects: [{ id: "a1", type: "Brep", layer: "Roof" }] });
    const asked = await rhino.waitFor("host.describe");
    rhino.send("host.described", { id: asked.payload.id, components: [component("a1")] });
    await expect.poll(() => link().components.length).toBe(1);
    expect(link().components[0]).toMatchObject({ id: "a1", material: "Timber" });
  });

  it("a host that cannot describe is not asked", async () => {
    await start();
    const rhino = await hostClient({ capabilities: { describe: false } });
    rhino.send("host.selection", { objects: [{ id: "a1", type: "Brep", layer: "Roof" }] });
    await new Promise((r) => setTimeout(r, 80));
    expect(rhino.received.some((m) => m.type === "host.describe")).toBe(false);
  });
});

describe("Settings > Hosts", () => {
  it("switch a host off: its layer goes, nothing of it is forwarded, and switching it on shows what was kept", async () => {
    await start();
    const early = await page();
    const rhino = await hostClient();
    await early.waitFor("host.state", (m) => m.payload.host === "rhino" && m.payload.connected);
    early.send("settings.set", { hosts: { rhino: false } });
    const off = await early.waitFor("host.state", (m) => m.payload.host === "rhino" && !m.payload.switchedOn);
    expect(off.payload).toMatchObject({ connected: true, objects: [] });
    expect(link().inUse).toBe(false);
    const asset = await rhino.uploadMesh();
    rhino.send("host.objects", hostBatch({ reset: true, changed: [hostObject("a1", asset)] }));
    await new Promise((r) => setTimeout(r, 100));
    expect(early.received.some((m) => m.type === "host.objects")).toBe(false);
    early.send("settings.set", { hosts: { rhino: true } });
    const shown = await early.waitFor(
      "host.state",
      (m) => m.payload.host === "rhino" && m.payload.switchedOn && m.payload.objects.length === 1,
    );
    expect(shown.payload.connected).toBe(true);
  });

  it("a host's run status is reported: unavailable with a reason, then ready", async () => {
    await start();
    const early = await page();
    const rhino = await hostClient({
      run: { state: "unavailable", reason: "Python 3 is not installed in Rhino" },
    });
    const state = await early.waitFor(
      "host.state",
      (m) => m.payload.host === "rhino" && m.payload.run?.state === "unavailable",
    );
    expect(state.payload.run).toEqual({ state: "unavailable", reason: "Python 3 is not installed in Rhino" });
    rhino.send("host.status", { run: { state: "ready" }, document: "tower.3dm" });
    await early.waitFor(
      "host.state",
      (m) =>
        m.payload.host === "rhino" && m.payload.run?.state === "ready" && m.payload.document === "tower.3dm",
    );
  });
});

describe("running code in a host", () => {
  const result = (id: string, text: string) => ({ id, ok: true, stdout: "", result: text, durationMs: 1 });

  it("a run goes to the connector in the host's language and its answer comes back", async () => {
    await start();
    const rhino = await hostClient();
    const run = link().runCode("result = 1 + 1", 5000);
    const asked = await rhino.waitFor("host.run");
    expect(asked.payload).toMatchObject({
      host: "rhino",
      language: "python",
      code: "result = 1 + 1",
      timeoutMs: 5000,
    });
    rhino.send("host.result", result(asked.payload.id, "2"));
    expect(await run).toMatchObject({ ok: true, result: "2" });
  });

  it("Revit's runs are C#", async () => {
    await start();
    const revit = await hostClient({ host: "revit" });
    const run = link("revit").runCode("return 1;", 5000);
    expect((await revit.waitFor("host.run")).payload.language).toBe("csharp");
    revit.send("host.result", result((await revit.waitFor("host.run")).payload.id, "1"));
    await run;
  });

  it("with no host, or one that cannot run, or one switched off, the run is refused with why", async () => {
    await start();
    await expect(link().runCode("1", 1000)).rejects.toThrow(
      /Rhino is not connected. Run HaiConnect in Rhino/,
    );
    const rhino = await hostClient({ run: { state: "unavailable", reason: "no engine" } });
    await expect(link().runCode("1", 1000)).rejects.toThrow(/no engine/);
    rhino.send("host.status", { run: { state: "ready" }, document: null });
    await expect.poll(() => link().canRun).toBe(true);
    const browser = await page();
    browser.send("settings.set", { hosts: { rhino: false } });
    await expect.poll(() => link().inUse).toBe(false);
    await expect(link().runCode("1", 1000)).rejects.toThrow(/switched off in Settings > Hosts/);
  });

  it("a run in progress is failed when the host disconnects", async () => {
    await start();
    const rhino = await hostClient();
    const run = link().runCode("while True: pass", 5000);
    const failed = expect(run).rejects.toThrow(/disconnected/);
    await rhino.waitFor("host.run");
    rhino.ws.close();
    await failed;
  });

  it("the second script waits until the host has answered the first, and each goes out in the order asked", async () => {
    await start();
    const rhino = await hostClient();
    const first = link().runCode("1", 5000, { agent: "architect", title: "First" });
    const second = link().runCode("2", 5000, { agent: "product", title: "Second" });
    const asked = await rhino.waitFor("host.run");
    expect(asked.payload).toMatchObject({ code: "1", agent: "architect", title: "First" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(rhino.received.filter((m) => m.type === "host.run")).toHaveLength(1);
    rhino.send("host.result", result(asked.payload.id, "one"));
    expect(await first).toMatchObject({ result: "one" });
    const next = await rhino.waitFor("host.run", (m) => m.payload.code === "2");
    expect(next.payload).toMatchObject({ agent: "product", title: "Second" });
    rhino.send("host.result", result(next.payload.id, "two"));
    expect(await second).toMatchObject({ result: "two" });
  });

  it("each host has its own queue: a run in Blender does not wait for one in Rhino", async () => {
    await start();
    const rhino = await hostClient();
    const blender = await hostClient({ host: "blender" });
    void link()
      .runCode("1", 5000)
      .catch(() => {});
    await rhino.waitFor("host.run");
    const inBlender = link("blender").runCode("2", 5000);
    const asked = await blender.waitFor("host.run");
    blender.send("host.result", result(asked.payload.id, "two"));
    expect(await inBlender).toMatchObject({ result: "two" });
  });

  it("the part and the claim go with the script", async () => {
    await start();
    const rhino = await hostClient();
    const run = link().runCode("1", 5000, {
      agent: "architect",
      title: "Dome",
      part: "dome",
      claim: { part: "dome", ids: ["a"] },
    });
    const asked = await rhino.waitFor("host.run");
    expect(asked.payload).toMatchObject({ part: "dome", claim: { part: "dome", ids: ["a"] } });
    rhino.send("host.result", result(asked.payload.id, "ok"));
    await run;
  });

  it("a script stopped while it waits never goes to the host, and the one behind it still runs", async () => {
    await start();
    const rhino = await hostClient();
    const stop = new AbortController();
    const first = link().runCode("1", 5000);
    const waiting = link().runCode("2", 5000, {}, stop.signal);
    const third = link().runCode("3", 5000);
    const asked = await rhino.waitFor("host.run");
    stop.abort();
    await expect(waiting).rejects.toThrow(/stopped/);
    rhino.send("host.result", result(asked.payload.id, "one"));
    await first;
    const next = await rhino.waitFor("host.run", (m) => m.payload.code === "3");
    rhino.send("host.result", result(next.payload.id, "three"));
    await third;
    expect(rhino.received.filter((m) => m.type === "host.run").map((m) => m.payload.code)).toEqual([
      "1",
      "3",
    ]);
  });

  it("the time limit starts when the host gets the script, not while it waits", async () => {
    await start();
    const rhino = await hostClient();
    const first = link().runCode("1", 5000);
    const second = link().runCode("2", 1000);
    const asked = await rhino.waitFor("host.run");
    await new Promise((resolve) => setTimeout(resolve, 1200));
    rhino.send("host.result", result(asked.payload.id, "one"));
    await first;
    const next = await rhino.waitFor("host.run", (m) => m.payload.code === "2");
    rhino.send("host.result", result(next.payload.id, "two"));
    expect(await second).toMatchObject({ result: "two" });
  });

  it("scripts still waiting fail when the host disconnects", async () => {
    await start();
    const rhino = await hostClient();
    const first = link().runCode("1", 5000);
    const second = link().runCode("2", 5000);
    const failed = Promise.all([
      expect(first).rejects.toThrow(/disconnected/),
      expect(second).rejects.toThrow(/disconnected/),
    ]);
    await rhino.waitFor("host.run");
    rhino.ws.close();
    await failed;
  });

  it("a page can ask a host to undo the last run", async () => {
    await start();
    const rhino = await hostClient();
    const browser = await page();
    browser.send("host.undo", { host: "rhino" });
    await rhino.waitFor("host.undo");
  });
});

describe("captures, images, the API and descriptions", () => {
  it("capture Rhino's view: the connector uploads a PNG and answers with it", async () => {
    await start();
    const rhino = await hostClient();
    const captured = link().capture("top", 1280, 720);
    const asked = await rhino.waitFor("host.capture");
    expect(asked.payload).toMatchObject({ view: "top", width: 1280, height: 720 });
    const asset = await rhino.uploadCapture();
    rhino.send("host.captured", { id: asked.payload.id, ok: true, asset, durationMs: 640 });
    expect(await captured).toEqual({ ok: true, asset, durationMs: 640 });
  });

  it("a capture upload must be a PNG, from a connector, and is never served to a page", async () => {
    await start();
    const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
    const put = (body: Uint8Array, origin?: string) =>
      fetch(`http://127.0.0.1:${address.port}/captures/${id}`, {
        method: "PUT",
        headers: { authorization: `Bearer ${TOKEN}`, ...(origin ? { origin } : {}) },
        body,
      });
    expect((await put(new Uint8Array(40))).status).toBe(400);
    expect((await put(new Uint8Array(40), ORIGIN)).status).toBe(403);
    const get = await fetch(`http://127.0.0.1:${address.port}/captures/${id}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(get.status).toBe(403);
  });

  it("a host that cannot capture says so without asking it", async () => {
    await start();
    const rhino = await hostClient({ capabilities: { capture: false } });
    expect(await link().capture(undefined, 640, 480)).toEqual({
      ok: false,
      error: "Rhino cannot capture its view.",
    });
    expect(rhino.received.some((m) => m.type === "host.capture")).toBe(false);
  });

  it("placing an image sends the connector the path, the plane and the size, and returns the picture's id", async () => {
    await start();
    const rhino = await hostClient();
    const placed = link().placeImage({
      path: "D:/p/site.jpg",
      origin: [0, 0, 0],
      normal: [0, -1, 0],
      widthMm: 40_000,
      agent: "architect",
      title: "Site photo",
    });
    const asked = await rhino.waitFor("host.image.place");
    expect(asked.payload).toMatchObject({ path: "D:/p/site.jpg", normal: [0, -1, 0], widthMm: 40_000 });
    rhino.send("host.image.placed", { id: asked.payload.id, ok: true, objectId: "f1" });
    expect(await placed).toEqual({ ok: true, objectId: "f1" });
  });

  it("look up a Rhino method: the query goes to the connector and its entries come back", async () => {
    await start();
    const rhino = await hostClient();
    const looked = link().api("Brep.CreateFromLoft");
    const asked = await rhino.waitFor("host.api");
    rhino.send("host.api.result", {
      id: asked.payload.id,
      entries: [
        {
          name: "Rhino.Geometry.Brep.CreateFromLoft",
          kind: "method",
          signature: "Brep[] CreateFromLoft(...)",
        },
      ],
      truncated: false,
    });
    expect((await looked).entries[0]?.name).toBe("Rhino.Geometry.Brep.CreateFromLoft");
  });

  it("describe by id", async () => {
    await start();
    const rhino = await hostClient();
    const described = link().describe(["a1", "a2"]);
    const asked = await rhino.waitFor("host.describe");
    expect(asked.payload.ids).toEqual(["a1", "a2"]);
    rhino.send("host.described", { id: asked.payload.id, components: [] });
    expect(await described).toEqual([]);
  });

  it("a request in flight fails when the host disconnects", async () => {
    await start();
    const rhino = await hostClient();
    const looked = link().api("x");
    await rhino.waitFor("host.api");
    rhino.ws.close();
    await expect(looked).rejects.toThrow(/disconnected before it answered/);
  });
});

describe("project files and opening them in a host", () => {
  const getFile = (path: string, token: string | null = TOKEN) =>
    fetch(`http://127.0.0.1:${address.port}/project-file/${encodeURI(path)}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  it("a .3dm in the project is served to the viewer, with the token", async () => {
    await start();
    const projectDir = bridge?.scene.projectDir ?? "";
    mkdirSync(join(projectDir, "models"), { recursive: true });
    writeFileSync(join(projectDir, "models", "canopy.3dm"), Buffer.from("3dm bytes"));
    const res = await getFile("models/canopy.3dm");
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("3dm bytes");
    expect((await getFile("models/canopy.3dm", null)).status).toBe(401);
  });

  it("nothing else is served: other file types, paths out of the project, and .hai", async () => {
    await start();
    const projectDir = bridge?.scene.projectDir ?? "";
    mkdirSync(join(projectDir, ".hai"), { recursive: true });
    writeFileSync(join(projectDir, "notes.txt"), "x");
    writeFileSync(join(projectDir, ".hai", "secret.3dm"), "x");
    writeFileSync(join(projectDir, "..", "outside.3dm"), "x");
    for (const path of [
      "notes.txt",
      "../outside.3dm",
      "%2e%2e/outside.3dm",
      ".hai/secret.3dm",
      "missing.3dm",
      "C:/Windows/win.ini",
    ]) {
      expect((await getFile(path)).status, path).toBe(404);
    }
  });

  it("opening in a host sends the connector the absolute path of a .3dm inside the project, and refuses the rest", async () => {
    await start();
    const projectDir = bridge?.scene.projectDir ?? "";
    writeFileSync(join(projectDir, "canopy.3dm"), "x");
    const rhino = await hostClient();
    const early = await page();
    early.send("host.open", { host: "rhino", path: "canopy.3dm" });
    const opened = await rhino.waitFor("host.open");
    expect(opened.payload.path.toLowerCase()).toBe(join(projectDir, "canopy.3dm").toLowerCase());
    early.send("host.open", { host: "rhino", path: "../../Windows/System32/cmd.exe" });
    await early.waitFor("request.error");
    expect(rhino.received.filter((m) => m.type === "host.open")).toHaveLength(1);
  });
});

describe("edits made in HAI", () => {
  const moveBy = (x: number) => [1, 0, 0, x, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

  it("move a host object by hand: the page's edit reaches the connector as it was made, and the answer reaches the page", async () => {
    await start();
    const rhino = await hostClient();
    const browser = await page();
    browser.send("host.edit", {
      host: "rhino",
      id: "edit-1",
      label: "Move",
      op: { op: "transform", ids: ["a1"], matrix: moveBy(2000) },
    });
    const asked = await rhino.waitFor("host.edit");
    expect(asked.payload).toMatchObject({
      id: "edit-1",
      label: "Move",
      op: { op: "transform", ids: ["a1"] },
    });
    expect(asked.payload.op.op === "transform" && asked.payload.op.matrix[3]).toBe(2000);
    rhino.send("host.edited", { id: "edit-1", ok: true });
    expect((await browser.waitFor("host.edited")).payload).toMatchObject({
      host: "rhino",
      id: "edit-1",
      ok: true,
    });
  });

  it("a refused edit: the host's reason reaches the page", async () => {
    await start();
    const rhino = await hostClient();
    const browser = await page();
    browser.send("host.edit", {
      host: "rhino",
      id: "edit-2",
      label: "Delete",
      op: { op: "delete", ids: ["gone"] },
    });
    await rhino.waitFor("host.edit");
    rhino.send("host.edited", { id: "edit-2", ok: false, error: "No object gone" });
    expect((await browser.waitFor("host.edited")).payload).toMatchObject({
      ok: false,
      error: "No object gone",
    });
  });

  it("a host without edits: nothing is sent, and the page is told the host does not take edits from HAI", async () => {
    await start();
    const rhino = await hostClient({ capabilities: { edit: false } });
    const browser = await page();
    browser.send("host.edit", {
      host: "rhino",
      id: "edit-3",
      label: "Move",
      op: { op: "delete", ids: ["a1"] },
    });
    const answer = await browser.waitFor("host.edited");
    expect(answer.payload).toMatchObject({ id: "edit-3", ok: false });
    expect(answer.payload.error).toMatch(/does not take edits from HAI/);
    expect(rhino.received.some((m) => m.type === "host.edit")).toBe(false);
  });

  it("an edit for a host that is not connected is answered at once", async () => {
    await start();
    const browser = await page();
    browser.send("host.edit", {
      host: "blender",
      id: "edit-4",
      label: "Move",
      op: { op: "delete", ids: ["a1"] },
    });
    expect((await browser.waitFor("host.edited")).payload.error).toMatch(/Blender is not connected/);
  });

  it("redo a host edit: the page's redo reaches the connector", async () => {
    await start();
    const rhino = await hostClient();
    const browser = await page();
    browser.send("host.redo", { host: "rhino" });
    await rhino.waitFor("host.redo");
  });
});
