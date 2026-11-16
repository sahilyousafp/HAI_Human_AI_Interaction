import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import { connectFakeHost, TINY_PNG } from "../../test/host-client.ts";
import { connectClient } from "../../test/ws-client.ts";
import { RHINO_DOCUMENT_SCRIPT } from "../hosts/adapters.ts";
import { type Bridge, createBridge } from "../server.ts";
import type { Caller } from "./agent-tokens.ts";

const ORIGIN = "http://localhost:5173";
const TOKEN = "host-tools-token-0123456789";
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
  bridge = createBridge({
    host: "127.0.0.1",
    port: 0,
    allowedOrigins: [ORIGIN],
    version: "t",
    token: TOKEN,
    mirrorDir: join(mkdtempSync(join(tmpdir(), "hai-hosttools-mirror-")), "m"),
    scene: { projectDir: join(mkdtempSync(join(tmpdir(), "hai-hosttools-")), "project"), saveDelayMs: 50 },
  });
  return bridge.start();
}

const HOST_TOOLS = new Set([
  "host_list",
  "host_run",
  "host_read",
  "host_capture",
  "host_place_image",
  "host_api",
  "host_describe",
]);

async function mcp(address: AddressInfo, caller: Caller = { agent: "architect", tools: HOST_TOOLS }) {
  if (!bridge) throw new Error("no bridge");
  const token = bridge.agentTokens.issue(caller);
  const client = new Client({ name: "test-agent", version: "1.0.0" });
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
const toolNames = async (address: AddressInfo, caller?: Caller) =>
  (await (await mcp(address, caller)).listTools()).tools.map((t) => t.name);
const fakeHost = (address: AddressInfo, options: Partial<Parameters<typeof connectFakeHost>[1]> = {}) =>
  connectFakeHost(address, { token: TOKEN, track: sockets, ...options });

describe("which host tools the agent has", () => {
  it("no host, no host tools; a connected host brings them; switching it off takes them away", async () => {
    const address = await start();
    expect(await toolNames(address)).not.toContain("host_run");
    const rhino = await fakeHost(address);
    expect(await toolNames(address)).toEqual(expect.arrayContaining([...HOST_TOOLS]));
    const page = await connectClient(address, { token: TOKEN, origin: ORIGIN, track: sockets });
    page.send("settings.set", { hosts: { rhino: false } });
    await page.waitFor("host.state", (m) => m.payload.host === "rhino" && !m.payload.switchedOn);
    expect(await toolNames(address)).not.toContain("host_run");
    rhino.ws.close();
  });

  it("the description names the hosts in use and what each does best, and only those", async () => {
    const address = await start();
    await fakeHost(address);
    await fakeHost(address, { host: "blender" });
    const agent = await mcp(address);
    const run = (await agent.listTools()).tools.find((t) => t.name === "host_run");
    expect(run?.description).toContain("- rhino (Rhino 8.36.0): best for form and NURBS");
    expect(run?.description).toContain("- blender (Blender 5.1.0): best for visualisation");
    expect(run?.description).not.toContain("revit");
    expect(run?.inputSchema.properties?.host).toMatchObject({ enum: ["rhino", "blender"] });
  });

  it("host_list says what each host can do now", async () => {
    const address = await start();
    await fakeHost(address, {
      run: { state: "unavailable", reason: "no engine" },
      capabilities: { capture: false },
    });
    const listed = json(await (await mcp(address)).callTool({ name: "host_list", arguments: {} }));
    expect(listed.hosts).toEqual([
      expect.objectContaining({
        host: "rhino",
        canRun: false,
        why: expect.stringContaining("no engine"),
        canCapture: false,
      }),
    ]);
  });
});

describe("host_run", () => {
  it("a script changes the document: it goes to the host, the answer comes back, and it is kept as a script", async () => {
    const address = await start();
    const rhino = await fakeHost(address);
    const agent = await mcp(address);
    const call = agent.callTool({
      name: "host_run",
      arguments: { host: "rhino", code: "# r: ladybug-core\nresult = 'lofted'", title: "Loft the canopy" },
    });
    const asked = await rhino.waitFor("host.run");
    expect(asked.payload).toMatchObject({ host: "rhino", language: "python", agent: "architect" });
    rhino.send("host.result", {
      id: asked.payload.id,
      ok: true,
      stdout: "done\n",
      result: "lofted",
      durationMs: 40,
      changes: {
        added: [{ id: "s1", name: "Canopy", tags: {}, bounds: null }],
        changed: [],
        deleted: [],
        truncated: false,
      },
    });
    const body = json(await call);
    expect(body).toMatchObject({
      ok: true,
      host: "rhino",
      output: "done\n",
      result: "lofted",
      changed: { added: 1, changed: 0, deleted: 0 },
    });
    const kept = readFileSync(join(bridge?.scene.projectDir ?? "", body.script), "utf8");
    expect(body.script).toMatch(/\.py$/);
    expect(kept).toContain("in Rhino");
    expect(kept).toContain("# packages: ladybug-core");
    expect(kept).toContain("# result: lofted");
  }, 30_000);

  it("a run in Revit is kept as C#", async () => {
    const address = await start();
    const revit = await fakeHost(address, { host: "revit" });
    const call = (await mcp(address)).callTool({
      name: "host_run",
      arguments: { host: "revit", code: "return doc.Title;", title: "Read the title" },
    });
    const asked = await revit.waitFor("host.run");
    expect(asked.payload.language).toBe("csharp");
    revit.send("host.result", { id: asked.payload.id, ok: true, stdout: "", result: "Tower", durationMs: 4 });
    const body = json(await call);
    expect(body.script).toMatch(/\.cs$/);
    expect(readFileSync(join(bridge?.scene.projectDir ?? "", body.script), "utf8")).toContain("// HAI run");
  }, 30_000);

  it("an error is returned, not thrown, so the agent can fix the script", async () => {
    const address = await start();
    const rhino = await fakeHost(address);
    const call = (await mcp(address)).callTool({
      name: "host_run",
      arguments: { host: "rhino", code: "boom()", title: "Boom" },
    });
    const asked = await rhino.waitFor("host.run");
    rhino.send("host.result", {
      id: asked.payload.id,
      ok: false,
      stdout: "",
      error: "NameError: name 'boom' is not defined",
      durationMs: 3,
    });
    const result = await call;
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("NameError");
  }, 30_000);

  it("a requirement line that is not a package is refused before the host is asked", async () => {
    const address = await start();
    const rhino = await fakeHost(address);
    const result = await (await mcp(address)).callTool({
      name: "host_run",
      arguments: { host: "rhino", code: "# r: --index-url=https://evil.example\nresult = 1", title: "Bad" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("not package names pip can install");
    expect(rhino.received.some((m) => m.type === "host.run")).toBe(false);
  });

  it("the host is named: a host that is not in use is refused, naming the ones that are", async () => {
    const address = await start();
    await fakeHost(address);
    const result = await (await mcp(address)).callTool({
      name: "host_run",
      arguments: { host: "blender", code: "1", title: "T" },
    });
    expect(result.isError).toBe(true);
  });

  it("run unavailable: the reason is shown to pages and the run is refused with it", async () => {
    const address = await start();
    const page = await connectClient(address, { token: TOKEN, origin: ORIGIN, track: sockets });
    await fakeHost(address, { run: { state: "unavailable", reason: "Python 3 is not installed in Rhino" } });
    const state = await page.waitFor(
      "host.state",
      (m) => m.payload.host === "rhino" && m.payload.run?.state === "unavailable",
    );
    expect(state.payload.run).toEqual({ state: "unavailable", reason: "Python 3 is not installed in Rhino" });
    const run = await (await mcp(address)).callTool({
      name: "host_run",
      arguments: { host: "rhino", code: "1", title: "T" },
    });
    expect(run.isError).toBe(true);
    expect(textOf(run)).toMatch(/Rhino cannot run code now: Python 3 is not installed in Rhino/);
  });
});

describe("host_read", () => {
  it("read the document: the bridge runs its own read-only script and returns what the host said", async () => {
    const address = await start();
    const rhino = await fakeHost(address);
    const agent = await mcp(address, { agent: "reviewer", tools: new Set(["host_read"]) });
    const call = agent.callTool({ name: "host_read", arguments: { host: "rhino" } });
    const asked = await rhino.waitFor("host.run");
    expect(asked.payload.code).toBe(RHINO_DOCUMENT_SCRIPT);
    expect(asked.payload.code).not.toMatch(/\.(Add|Delete|Select|Transform|Rotate|Move)\w*\(/); // it only reads
    rhino.send("host.result", {
      id: asked.payload.id,
      ok: true,
      stdout: "",
      result: JSON.stringify({
        name: "tower.3dm",
        units: "Millimeters",
        layers: [],
        objectCounts: {},
        selected: [],
      }),
      durationMs: 9,
    });
    expect(json(await call)).toMatchObject({ name: "tower.3dm", units: "Millimeters" });
  }, 30_000);

  it("a host with no read script says to use host_describe or host_run", async () => {
    const address = await start();
    await fakeHost(address, { host: "blender" });
    const result = await (await mcp(address)).callTool({ name: "host_read", arguments: { host: "blender" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("host_describe");
  });
});

describe("host_capture, host_place_image, host_api and host_describe", () => {
  it("capture Rhino's view: the agent gets the PNG, with how long it took", async () => {
    const address = await start();
    const rhino = await fakeHost(address);
    const started = Date.now();
    const call = (await mcp(address)).callTool({
      name: "host_capture",
      arguments: { host: "rhino", view: "top", width: 1280, height: 720 },
    });
    const asked = await rhino.waitFor("host.capture");
    const asset = await rhino.uploadCapture();
    rhino.send("host.captured", { id: asked.payload.id, ok: true, asset, durationMs: 640 });
    const result = (await call) as { content: Array<{ type: string; text?: string; data?: string }> };
    expect(result.content[0]?.text).toContain("Rhino, top, captured in 640 ms");
    expect(result.content[1]).toMatchObject({ type: "image", data: TINY_PNG.toString("base64") });
    // The relay adds little to the host's own time: the 1.5 s budget is the host's to keep.
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it("a site photo behind the model: a project image goes to the host with its absolute path", async () => {
    const address = await start();
    const projectDir = bridge?.scene.projectDir ?? "";
    mkdirSync(join(projectDir, ".hai", "images"), { recursive: true });
    writeFileSync(join(projectDir, ".hai", "images", "site.jpg"), "jpeg");
    const rhino = await fakeHost(address);
    const call = (await mcp(address)).callTool({
      name: "host_place_image",
      arguments: {
        host: "rhino",
        path: ".hai/images/site.jpg",
        origin: [0, 0, 0],
        normal: [0, 1, 0],
        widthMm: 40_000,
        title: "Site photo",
      },
    });
    const asked = await rhino.waitFor("host.image.place");
    expect(asked.payload.path.toLowerCase()).toBe(
      join(projectDir, ".hai", "images", "site.jpg").toLowerCase(),
    );
    expect(asked.payload).toMatchObject({ widthMm: 40_000, agent: "architect", title: "Site photo" });
    rhino.send("host.image.placed", { id: asked.payload.id, ok: true, objectId: "f1" });
    expect(json(await call)).toEqual({ ok: true, host: "rhino", objectId: "f1" });
  });

  it("outside the project: a path out of the project, a file that is not an image, or a missing one is refused", async () => {
    const address = await start();
    const projectDir = bridge?.scene.projectDir ?? "";
    writeFileSync(join(projectDir, "notes.txt"), "x");
    const rhino = await fakeHost(address);
    const agent = await mcp(address);
    const place = (path: string) =>
      agent.callTool({
        name: "host_place_image",
        arguments: { host: "rhino", path, origin: [0, 0, 0], normal: [0, 1, 0], widthMm: 1000, title: "T" },
      });
    expect(textOf(await place("C:/Windows/image.png"))).toContain("outside the project");
    expect(textOf(await place("../../outside.png"))).toContain("outside the project");
    expect(textOf(await place("notes.txt"))).toContain("Only");
    expect(textOf(await place("missing.png"))).toContain("no such image");
    expect(rhino.received.some((m) => m.type === "host.image.place")).toBe(false);
  });

  it("look up a Rhino method", async () => {
    const address = await start();
    const rhino = await fakeHost(address);
    const call = (await mcp(address)).callTool({
      name: "host_api",
      arguments: { host: "rhino", query: "Brep.CreateFromLoft" },
    });
    const asked = await rhino.waitFor("host.api");
    expect(asked.payload.query).toBe("Brep.CreateFromLoft");
    rhino.send("host.api.result", {
      id: asked.payload.id,
      entries: [
        {
          name: "Rhino.Geometry.Brep.CreateFromLoft",
          kind: "method",
          signature: "Brep[] CreateFromLoft(IEnumerable<Curve> curves, ...)",
        },
      ],
      truncated: false,
    });
    expect(json(await call).entries[0].signature).toContain("CreateFromLoft");
  });

  it("describe by id, with no approval card", async () => {
    const address = await start();
    const rhino = await fakeHost(address);
    const agent = await mcp(address, { agent: "reviewer", tools: new Set(["host_describe"]) });
    const call = agent.callTool({ name: "host_describe", arguments: { host: "rhino", ids: ["a1", "a2"] } });
    const asked = await rhino.waitFor("host.describe");
    const component = (id: string) => ({
      id,
      name: id,
      type: "Closed Brep",
      layer: "Roof",
      bounds: null,
      quantities: {},
      material: null,
      properties: {},
    });
    rhino.send("host.described", { id: asked.payload.id, components: [component("a1"), component("a2")] });
    expect(json(await call).components.map((c: { id: string }) => c.id)).toEqual(["a1", "a2"]);
    expect(bridge?.approvals.waiting ?? []).toEqual([]);
  });
});
