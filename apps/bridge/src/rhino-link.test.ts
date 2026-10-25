import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOKEN_PROTOCOL_PREFIX, WS_PATH, WS_PROTOCOL } from "@hai/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { connectFakeRhino, rhinoBatch, rhinoObject } from "../test/rhino-client.ts";
import { connectClient } from "../test/ws-client.ts";
import {
  discoveryFilePath,
  readDiscoveryFile,
  removeDiscoveryFile,
  writeDiscoveryFile,
} from "./discovery-file.ts";
import { type Bridge, createBridge } from "./server.ts";

const ORIGIN = "http://localhost:5173";
const TOKEN = "rhino-test-token-0123456789";
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
    scene: { projectDir: join(temp("hai-rhino-"), "project"), saveDelayMs: 50 },
  });
  address = await bridge.start();
  return bridge;
}

const page = () => connectClient(address, { token: TOKEN, origin: ORIGIN, track: sockets });
const rhinoClient = (options: Partial<Parameters<typeof connectFakeRhino>[1]> = {}) =>
  connectFakeRhino(address, { token: TOKEN, track: sockets, ...options });
const mirrorFile = (asset: string) => join(mirrorDir, "assets", `${asset}.haimesh`);

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

describe("who may connect as Rhino", () => {
  it("Rhino plugin connects: a local program with the token and no Origin is accepted as the Rhino client", async () => {
    await start();
    const rhino = await rhinoClient();
    expect(rhino.received.some((m) => m.type === "bridge.status")).toBe(true);
    expect(bridge?.rhino.connected).toBe(true);
    // It is not a page: the client count does not include it.
    const status = (await rhino.waitFor("bridge.status")).payload;
    expect(status.clients).toBe(0);
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

  it("a web page cannot say hello as Rhino, and a local program cannot say hello as a page", async () => {
    await start();
    const asPage = new WebSocket(
      `ws://127.0.0.1:${address.port}${WS_PATH}`,
      [WS_PROTOCOL, `${TOKEN_PROTOCOL_PREFIX}${TOKEN}`],
      {
        headers: { origin: ORIGIN },
      },
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
          protocolVersion: 1,
          rhinoVersion: "8",
          pluginVersion: "1",
          python: { state: "ready" },
          document: null,
        },
      }),
    );
    expect(await closedPage).toBe(1008);

    const asLocal = new WebSocket(`ws://127.0.0.1:${address.port}${WS_PATH}`, [
      WS_PROTOCOL,
      `${TOKEN_PROTOCOL_PREFIX}${TOKEN}`,
    ]);
    sockets.push(asLocal);
    await new Promise((r) => asLocal.once("open", r));
    const closedLocal = new Promise<number>((r) => asLocal.once("close", (code) => r(code)));
    asLocal.send(JSON.stringify({ type: "hello", id: "h", payload: { client: "web", protocolVersion: 1 } }));
    expect(await closedLocal).toBe(1008);
    expect(bridge?.rhino.connected).toBe(false);
  });

  it("the plugin may report on Rhino and nothing else: a scene edit from it closes the connection", async () => {
    await start();
    const rhino = await rhinoClient();
    const closed = new Promise<number>((r) => rhino.ws.once("close", (code) => r(code)));
    rhino.send("scene.apply", { label: "x", ops: [{ op: "delete", id: "wall-n" }] });
    expect(await closed).toBe(1008);
    expect(bridge?.scene.scene.doc.elements["wall-n"]).toBeDefined();
  });

  it("a second plugin connection replaces the first", async () => {
    await start();
    const first = await rhinoClient();
    const closed = new Promise<number>((r) => first.ws.once("close", (code) => r(code)));
    await rhinoClient();
    expect(await closed).toBe(1000);
    expect(bridge?.rhino.connected).toBe(true);
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
});

describe("the mirror", () => {
  it("a page connecting later gets Rhino's objects, and a change reaches a page already open", async () => {
    await start();
    const rhino = await rhinoClient();
    const early = await page();
    const asset = await rhino.uploadMesh();
    rhino.send("rhino.objects", rhinoBatch({ reset: true, changed: [rhinoObject("a1", asset)] }));
    const live = await early.waitFor("rhino.objects");
    expect(live.payload.changed.map((o) => o.id)).toEqual(["a1"]);

    const late = await page();
    const state = await late.waitFor("rhino.state", (m) => m.payload.objects.length === 1);
    expect(state.payload).toMatchObject({ connected: true, mode: "auto", inUse: "rhino" });
    expect(state.payload.objects[0]?.id).toBe("a1");
  });

  it("a moved, replaced and deleted object follow, and a replaced mesh is dropped from disk", async () => {
    await start();
    const rhino = await rhinoClient();
    const early = await page();
    const first = await rhino.uploadMesh();
    rhino.send("rhino.objects", rhinoBatch({ reset: true, changed: [rhinoObject("a1", first)] }));
    await early.waitFor("rhino.objects");
    expect(existsSync(mirrorFile(first))).toBe(true);

    const second = await rhino.uploadMesh(2000);
    rhino.send("rhino.objects", rhinoBatch({ changed: [rhinoObject("a1", second)] }));
    await early.waitFor("rhino.objects", (m) => m.payload.changed[0]?.asset === second);
    expect(existsSync(mirrorFile(first))).toBe(false);
    expect(existsSync(mirrorFile(second))).toBe(true);

    rhino.send("rhino.objects", rhinoBatch({ deleted: ["a1"] }));
    await early.waitFor("rhino.objects", (m) => m.payload.deleted.includes("a1"));
    expect(existsSync(mirrorFile(second))).toBe(false);
    expect(bridge?.rhino.object("a1")).toBeUndefined();
  });

  it("an asset is uploaded before its descriptor: an object whose mesh is missing is not forwarded", async () => {
    await start();
    const rhino = await rhinoClient();
    const early = await page();
    const real = await rhino.uploadMesh();
    const never = "11111111-2222-4333-8444-555555555555";
    rhino.send(
      "rhino.objects",
      rhinoBatch({ reset: true, changed: [rhinoObject("ok", real), rhinoObject("ghost", never)] }),
    );
    const batch = await early.waitFor("rhino.objects");
    expect(batch.payload.changed.map((o) => o.id)).toEqual(["ok"]);
    expect(bridge?.rhino.object("ghost")).toBeUndefined();
  });

  it("an object drawn as its box (too heavy) has no asset and is forwarded", async () => {
    await start();
    const rhino = await rhinoClient();
    const early = await page();
    rhino.send(
      "rhino.objects",
      rhinoBatch({
        reset: true,
        changed: [rhinoObject("big", null)],
        notDrawn: { curves: 12, points: 0, annotations: 1, other: 0, heavy: 1 },
      }),
    );
    const batch = await early.waitFor("rhino.objects");
    expect(batch.payload.changed[0]?.asset).toBeNull();
    expect(batch.payload.notDrawn).toMatchObject({ curves: 12, heavy: 1 });
  });

  it("the first sync reports progress, and a reset replaces what was held", async () => {
    await start();
    const rhino = await rhinoClient();
    const early = await page();
    const a = await rhino.uploadMesh();
    rhino.send(
      "rhino.objects",
      rhinoBatch({ reset: true, sync: { done: 1, total: 3 }, changed: [rhinoObject("a", a)] }),
    );
    expect((await early.waitFor("rhino.objects")).payload.sync).toEqual({ done: 1, total: 3 });
    const b = await rhino.uploadMesh();
    rhino.send("rhino.objects", rhinoBatch({ reset: true, changed: [rhinoObject("b", b)] }));
    await early.waitFor("rhino.objects", (m) => m.payload.changed[0]?.id === "b");
    expect(bridge?.rhino.object("a")).toBeUndefined();
    expect(existsSync(mirrorFile(a))).toBe(false);
  });

  it("disconnect clears the mirror: pages are told, and the meshes are removed", async () => {
    await start();
    const rhino = await rhinoClient();
    const early = await page();
    const asset = await rhino.uploadMesh();
    rhino.send("rhino.objects", rhinoBatch({ reset: true, changed: [rhinoObject("a1", asset)] }));
    await early.waitFor("rhino.objects");
    rhino.ws.close();
    const cleared = await early.waitFor("rhino.state", (m) => !m.payload.connected);
    expect(cleared.payload).toMatchObject({ connected: false, inUse: "python", objects: [] });
    expect(existsSync(mirrorFile(asset))).toBe(false);
  });

  it("meshes live apart from the project: they are not in the project's assets folder", async () => {
    await start();
    const rhino = await rhinoClient();
    const asset = await rhino.uploadMesh();
    const projectDir = bridge?.scene.projectDir ?? "";
    expect(existsSync(join(projectDir, "assets", `${asset}.haimesh`))).toBe(false);
    expect(existsSync(mirrorFile(asset))).toBe(true);
    // The project's own assets route does not see it either.
    const res = await fetch(`http://127.0.0.1:${address.port}/assets/${asset}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(404);
  });

  it("a mesh upload needs the token", async () => {
    await start();
    const res = await fetch(`http://127.0.0.1:${address.port}/mirror/0f8fad5b-d9cb-469f-a165-70867728950e`, {
      method: "PUT",
      body: new Uint8Array(20),
    });
    expect(res.status).toBe(401);
  });
});

describe("selection both ways", () => {
  it("mouse selection mirrored: Rhino's selection reaches the bridge and the pages", async () => {
    await start();
    const rhino = await rhinoClient();
    const early = await page();
    const asset = await rhino.uploadMesh();
    rhino.send(
      "rhino.objects",
      rhinoBatch({ reset: true, changed: [rhinoObject("a1", asset), rhinoObject("a2", asset)] }),
    );
    await early.waitFor("rhino.objects");
    rhino.send("rhino.selection", {
      objects: [
        { id: "a1", type: "Brep", layer: "Facade" },
        { id: "a2", type: "Brep", layer: "Facade" },
      ],
    });
    const seen = await early.waitFor("rhino.selection");
    expect(seen.payload.objects.map((o) => o.id)).toEqual(["a1", "a2"]);
    expect(bridge?.rhino.selection.map((s) => s.id)).toEqual(["a1", "a2"]);
  });

  it("a pick selects in Rhino: the page's select reaches the plugin", async () => {
    await start();
    const rhino = await rhinoClient();
    const early = await page();
    early.send("rhino.select", { ids: ["a1"] });
    const asked = await rhino.waitFor("rhino.select");
    expect(asked.payload.ids).toEqual(["a1"]);
    early.send("rhino.select", { ids: [] });
    await rhino.waitFor("rhino.select", (m) => m.payload.ids.length === 0);
  });

  it("with no Rhino connected a pick goes nowhere and breaks nothing", async () => {
    await start();
    const early = await page();
    early.send("rhino.select", { ids: ["a1"] });
    await new Promise((r) => setTimeout(r, 50));
    expect(early.ws.readyState).toBe(WebSocket.OPEN);
  });
});

describe("the modelling mode", () => {
  it("Automatic follows the connection, and the setting overrides it", async () => {
    await start();
    const early = await page();
    expect((await early.waitFor("rhino.state")).payload).toMatchObject({
      mode: "auto",
      inUse: "python",
      connected: false,
    });
    const rhino = await rhinoClient();
    await early.waitFor("rhino.state", (m) => m.payload.connected && m.payload.inUse === "rhino");
    early.send("settings.set", { modelling: "python" });
    const python = await early.waitFor("rhino.state", (m) => m.payload.mode === "python");
    expect(python.payload).toMatchObject({ inUse: "python", connected: true, objects: [] });
    early.send("settings.set", { modelling: "rhino" });
    await early.waitFor("rhino.state", (m) => m.payload.mode === "rhino" && m.payload.inUse === "rhino");
    rhino.ws.close();
    await early.waitFor("rhino.state", (m) => !m.payload.connected && m.payload.mode === "rhino");
  });

  it("Python only hides the mirror: no objects are forwarded while it is chosen", async () => {
    await start();
    const early = await page();
    const rhino = await rhinoClient();
    early.send("settings.set", { modelling: "python" });
    await early.waitFor("rhino.state", (m) => m.payload.mode === "python");
    const asset = await rhino.uploadMesh();
    rhino.send("rhino.objects", rhinoBatch({ reset: true, changed: [rhinoObject("a1", asset)] }));
    await new Promise((r) => setTimeout(r, 100));
    expect(early.received.some((m) => m.type === "rhino.objects")).toBe(false);
    // Choosing Rhino again shows what was kept.
    early.send("settings.set", { modelling: "auto" });
    const shown = await early.waitFor("rhino.state", (m) => m.payload.objects.length === 1);
    expect(shown.payload.inUse).toBe("rhino");
  });

  it("Python status is reported: ready, then unavailable with a reason", async () => {
    await start();
    const early = await page();
    const rhino = await rhinoClient({
      python: { state: "unavailable", reason: "Python 3 is not installed in Rhino" },
    });
    const state = await early.waitFor("rhino.state", (m) => m.payload.python?.state === "unavailable");
    expect(state.payload.python).toEqual({
      state: "unavailable",
      reason: "Python 3 is not installed in Rhino",
    });
    rhino.send("rhino.status", { python: { state: "ready" }, document: "tower.3dm" });
    await early.waitFor(
      "rhino.state",
      (m) => m.payload.python?.state === "ready" && m.payload.document === "tower.3dm",
    );
  });
});

describe("running Python in Rhino", () => {
  it("a run goes to the plugin and its answer comes back", async () => {
    await start();
    const rhino = await rhinoClient();
    const run = bridge?.rhino.runPython("result = 1 + 1", 5000);
    const asked = await rhino.waitFor("rhino.python.run");
    expect(asked.payload).toMatchObject({ code: "result = 1 + 1", timeoutMs: 5000 });
    rhino.send("rhino.python.result", {
      id: asked.payload.id,
      ok: true,
      stdout: "",
      result: "2",
      durationMs: 12,
    });
    expect(await run).toMatchObject({ ok: true, result: "2" });
  });

  it("with no Rhino, or Python unavailable in it, the run is refused with why", async () => {
    await start();
    await expect(bridge?.rhino.runPython("1", 1000)).rejects.toThrow(/not connected/);
    await rhinoClient({ python: { state: "unavailable", reason: "no engine" } });
    await expect(bridge?.rhino.runPython("1", 1000)).rejects.toThrow(/no engine/);
  });

  it("a run in progress is failed when Rhino disconnects", async () => {
    await start();
    const rhino = await rhinoClient();
    const run = bridge?.rhino.runPython("while True: pass", 5000);
    const failed = expect(run).rejects.toThrow(/disconnected/);
    await rhino.waitFor("rhino.python.run");
    rhino.ws.close();
    await failed;
  });
});

describe("scripts take turns", () => {
  const result = (id: string, text: string) => ({ id, ok: true, stdout: "", result: text, durationMs: 1 });

  it("the second script waits until Rhino has answered the first, and each goes out in the order asked", async () => {
    await start();
    const rhino = await rhinoClient();
    const first = bridge?.rhino.runPython("1", 5000, { agent: "architect", title: "First" });
    const second = bridge?.rhino.runPython("2", 5000, { agent: "product", title: "Second" });
    const asked = await rhino.waitFor("rhino.python.run");
    expect(asked.payload).toMatchObject({ code: "1", agent: "architect", title: "First" });
    // Nothing else has been sent while the first one runs.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(rhino.received.filter((m) => m.type === "rhino.python.run")).toHaveLength(1);
    rhino.send("rhino.python.result", result(asked.payload.id, "one"));
    expect(await first).toMatchObject({ result: "one" });
    const next = await rhino.waitFor("rhino.python.run", (m) => m.payload.code === "2");
    expect(next.payload).toMatchObject({ agent: "product", title: "Second" });
    rhino.send("rhino.python.result", result(next.payload.id, "two"));
    expect(await second).toMatchObject({ result: "two" });
  });

  it("the part and the claim go with the script", async () => {
    await start();
    const rhino = await rhinoClient();
    const run = bridge?.rhino.runPython("1", 5000, {
      agent: "architect",
      title: "Dome",
      part: "dome",
      claim: { part: "dome", ids: ["a"] },
    });
    const asked = await rhino.waitFor("rhino.python.run");
    expect(asked.payload).toMatchObject({ part: "dome", claim: { part: "dome", ids: ["a"] } });
    rhino.send("rhino.python.result", result(asked.payload.id, "ok"));
    await run;
  });

  it("a script stopped while it waits never goes to Rhino, and the one behind it still runs", async () => {
    await start();
    const rhino = await rhinoClient();
    const stop = new AbortController();
    const first = bridge?.rhino.runPython("1", 5000);
    const waiting = bridge?.rhino.runPython("2", 5000, {}, stop.signal);
    const third = bridge?.rhino.runPython("3", 5000);
    const asked = await rhino.waitFor("rhino.python.run");
    stop.abort();
    await expect(waiting).rejects.toThrow(/stopped/);
    rhino.send("rhino.python.result", result(asked.payload.id, "one"));
    await first;
    const next = await rhino.waitFor("rhino.python.run", (m) => m.payload.code === "3");
    rhino.send("rhino.python.result", result(next.payload.id, "three"));
    await third;
    expect(rhino.received.filter((m) => m.type === "rhino.python.run").map((m) => m.payload.code)).toEqual([
      "1",
      "3",
    ]);
  });

  it("the time limit starts when Rhino gets the script, not while it waits", async () => {
    await start();
    const rhino = await rhinoClient();
    const first = bridge?.rhino.runPython("1", 5000);
    const second = bridge?.rhino.runPython("2", 1000);
    const asked = await rhino.waitFor("rhino.python.run");
    // Longer than the second script's own limit plus the grace period would be if it had started counting.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    rhino.send("rhino.python.result", result(asked.payload.id, "one"));
    await first;
    const next = await rhino.waitFor("rhino.python.run", (m) => m.payload.code === "2");
    rhino.send("rhino.python.result", result(next.payload.id, "two"));
    expect(await second).toMatchObject({ result: "two" });
  });

  it("scripts still waiting fail when Rhino disconnects", async () => {
    await start();
    const rhino = await rhinoClient();
    const first = bridge?.rhino.runPython("1", 5000);
    const second = bridge?.rhino.runPython("2", 5000);
    const failed = Promise.all([
      expect(first).rejects.toThrow(/disconnected/),
      expect(second).rejects.toThrow(/disconnected/),
    ]);
    await rhino.waitFor("rhino.python.run");
    rhino.ws.close();
    await failed;
  });

  it("a page can ask Rhino to undo the last run", async () => {
    await start();
    const rhino = await rhinoClient();
    const browser = await page();
    browser.send("rhino.undo", {});
    await rhino.waitFor("rhino.undo");
  });
});

describe("the discovery file is read by the plugin", () => {
  it("holds a token that works for the local connection", async () => {
    await start();
    const file = join(temp("hai-discovery-"), "bridge.json");
    writeDiscoveryFile(file, { port: address.port, token: TOKEN, pid: process.pid, startedAt: "x" });
    const info = JSON.parse(readFileSync(file, "utf8"));
    const rhino = await connectFakeRhino(
      { ...address, port: info.port },
      { token: info.token, track: sockets },
    );
    expect(rhino.received.some((m) => m.type === "bridge.status")).toBe(true);
  });
});

describe("project files and opening them in Rhino", () => {
  const getFile = (path: string, token: string | null = TOKEN) =>
    fetch(`http://127.0.0.1:${address.port}/project-file/${encodeURI(path)}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  it("a .3dm in the project is served to the viewer, with the token", async () => {
    await start();
    const { writeFileSync, mkdirSync } = await import("node:fs");
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
    const { writeFileSync, mkdirSync } = await import("node:fs");
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

  it("opening in Rhino sends the plugin the absolute path of a .3dm inside the project, and refuses the rest", async () => {
    await start();
    const { writeFileSync } = await import("node:fs");
    const projectDir = bridge?.scene.projectDir ?? "";
    writeFileSync(join(projectDir, "canopy.3dm"), "x");
    const rhino = await rhinoClient();
    const early = await page();
    early.send("rhino.open", { path: "canopy.3dm" });
    const opened = await rhino.waitFor("rhino.open");
    expect(opened.payload.path.toLowerCase()).toBe(join(projectDir, "canopy.3dm").toLowerCase());
    early.send("rhino.open", { path: "../../Windows/System32/cmd.exe" });
    await early.waitFor("request.error");
    expect(rhino.received.filter((m) => m.type === "rhino.open")).toHaveLength(1);
  });
});
