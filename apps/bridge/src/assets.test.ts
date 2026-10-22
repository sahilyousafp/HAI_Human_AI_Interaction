import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { Element, Message } from "@aex/protocol";
import { encodeMeshAsset } from "@aex/scene";
import { afterEach, describe, expect, it } from "vitest";
import { AssetStore } from "./assets.ts";
import { type Bridge, createBridge } from "./server.ts";

const ORIGIN = "http://localhost:5173";
const TOKEN = "test-token-0123456789";
const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const OTHER_ID = "1a2b3c4d-1111-4222-8333-444455556666";

const asset = (): Uint8Array =>
  encodeMeshAsset([
    { positions: new Float32Array([0, 0, 0, 1000, 0, 0, 0, 1000, 500]), indices: new Uint32Array([0, 1, 2]) },
  ]);

const folders: string[] = [];
const tempProject = () => {
  const dir = mkdtempSync(join(tmpdir(), "aex-assets-"));
  folders.push(dir);
  return dir;
};
const bridges: Bridge[] = [];

async function start(projectDir?: string): Promise<{ bridge: Bridge; base: string }> {
  const bridge = createBridge({
    host: "127.0.0.1",
    port: 0,
    allowedOrigins: [ORIGIN],
    version: "test",
    token: TOKEN,
    scene: projectDir ? { projectDir, saveDelayMs: 0 } : {},
  });
  bridges.push(bridge);
  const address: AddressInfo = await bridge.start();
  return { bridge, base: `http://127.0.0.1:${address.port}` };
}

afterEach(async () => {
  for (const bridge of bridges.splice(0)) await bridge.stop();
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const auth = { authorization: `Bearer ${TOKEN}`, origin: ORIGIN };
const put = (base: string, id: string, body: Uint8Array | string, headers: Record<string, string> = auth) =>
  fetch(`${base}/assets/${id}`, { method: "PUT", headers, body });

const imported = (id: string, assetId: string): Element => ({
  id,
  type: "imported",
  name: id,
  properties: {},
  asset: assetId,
  part: 0,
  bounds: { min: [0, 0, 0], max: [1000, 1000, 500] },
  translation: [0, 0, 0],
});

const apply = (bridge: Bridge, element: Element) =>
  bridge.scene.handle(
    { type: "scene.apply", id: "m1", payload: { label: "Import", ops: [{ op: "create", element }] } },
    (_m: Message) => {},
  );

describe("asset routes", () => {
  it("stores a model and serves it back, for an allowed origin only", async () => {
    const { base } = await start(tempProject());
    const bytes = asset();
    expect((await put(base, ID, bytes)).status).toBe(204);
    const got = await fetch(`${base}/assets/${ID}`, { headers: auth });
    expect(got.status).toBe(200);
    expect(got.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(bytes);
  });

  it("answers the browser's preflight for an allowed origin and refuses a foreign one", async () => {
    const { base } = await start(tempProject());
    const preflight = await fetch(`${base}/assets/${ID}`, {
      method: "OPTIONS",
      headers: { origin: ORIGIN, "access-control-request-method": "PUT" },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-headers")).toMatch(/authorization/);
    const foreign = await fetch(`${base}/assets/${ID}`, {
      headers: { ...auth, origin: "https://evil.example" },
    });
    expect(foreign.status).toBe(403);
    expect(foreign.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("refuses a request without the session token, or with a wrong one", async () => {
    const { base } = await start(tempProject());
    expect((await put(base, ID, asset(), { origin: ORIGIN })).status).toBe(401);
    expect((await put(base, ID, asset(), { origin: ORIGIN, authorization: "Bearer nope" })).status).toBe(401);
    expect((await fetch(`${base}/assets/${ID}`, { headers: { origin: ORIGIN } })).status).toBe(401);
  });

  it("refuses an id that is not a UUID, so no path ever comes from the caller", async () => {
    const dir = tempProject();
    const { base } = await start(dir);
    expect((await put(base, "not-an-id", asset())).status).toBe(400);
    expect((await put(base, "..%2F..%2Fscene.aex.json", asset())).status).toBe(400);
    expect(existsSync(join(dir, "assets"))).toBe(false);
  });

  it("refuses bytes that are not a model and leaves nothing behind", async () => {
    const dir = tempProject();
    const { base } = await start(dir);
    const response = await put(base, ID, "this is not a model file at all");
    expect(response.status).toBe(400);
    expect(readdirSync(join(dir, "assets"))).toEqual([]);
  });

  it("refuses a model whose header promises more than the file holds", async () => {
    const dir = tempProject();
    const { base } = await start(dir);
    const bytes = asset();
    expect((await put(base, ID, bytes.slice(0, bytes.length - 8))).status).toBe(400);
    expect(readdirSync(join(dir, "assets"))).toEqual([]);
  });

  it("says so when no project folder is open", async () => {
    const { base } = await start();
    expect((await put(base, ID, asset())).status).toBe(409);
  });

  it("answers 404 for a model that is not there", async () => {
    const { base } = await start(tempProject());
    expect((await fetch(`${base}/assets/${ID}`, { headers: auth })).status).toBe(404);
  });
});

describe("asset store", () => {
  it("stops an upload that runs over the limit, keeping nothing", async () => {
    const dir = tempProject();
    const store = new AssetStore(() => dir);
    const result = await store.write(ID, Readable.from([asset(), asset()]), 100);
    expect(result).toMatchObject({ ok: false, status: 413 });
    expect(store.has(ID)).toBe(false);
    expect(readdirSync(join(dir, "assets"))).toEqual([]);
  });
});

describe("assets and projects", () => {
  it("a model survives a restart", async () => {
    const dir = tempProject();
    const first = await start(dir);
    await put(first.base, ID, asset());
    apply(first.bridge, imported("i-1", ID));
    await first.bridge.stop();
    bridges.pop();

    const second = await start(dir);
    expect(second.bridge.scene.assets.has(ID)).toBe(true);
    expect(second.bridge.scene.scene.doc.elements["i-1"]).toMatchObject({ type: "imported", asset: ID });
    expect((await fetch(`${second.base}/assets/${ID}`, { headers: auth })).status).toBe(200);
  });

  it("removes a model no element refers to when the project opens", async () => {
    const dir = tempProject();
    const first = await start(dir);
    await put(first.base, ID, asset());
    await put(first.base, OTHER_ID, asset());
    apply(first.bridge, imported("i-1", ID));
    await first.bridge.stop();
    bridges.pop();

    const second = await start(dir);
    expect(second.bridge.scene.assets.has(ID)).toBe(true);
    expect(second.bridge.scene.assets.has(OTHER_ID)).toBe(false);
  });

  it("opens a project whose model file is gone, and the status names it", async () => {
    const dir = tempProject();
    const first = await start(dir);
    await put(first.base, ID, asset());
    apply(first.bridge, imported("i-1", ID));
    await first.bridge.stop();
    bridges.pop();
    rmSync(join(dir, "assets", `${ID}.aexmesh`));

    const second = await start(dir);
    const sent: Message[] = [];
    second.bridge.scene.greet((m) => sent.push(m));
    const status = sent.find((m) => m.type === "project.status");
    expect(status).toMatchObject({ payload: { error: expect.stringContaining(`${ID}.aexmesh`) } });
    expect(second.bridge.scene.scene.doc.elements["i-1"]).toBeDefined();
  });
});
