import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { connectClient } from "../../test/ws-client.ts";
import { ApprovalBroker } from "../agent/approvals.ts";
import type { Transport } from "../open-data/client.ts";
import { type Bridge, createBridge } from "../server.ts";
import type { Caller } from "./agent-tokens.ts";

const ORIGIN = "http://localhost:5173";
const TOKEN = "open-data-test-token-0123456789";
let bridge: Bridge | null = null;
const sockets: WebSocket[] = [];
const clients: Client[] = [];

afterEach(async () => {
  for (const c of clients.splice(0)) await c.close();
  for (const ws of sockets.splice(0)) ws.close();
  await bridge?.stop();
  bridge = null;
});

async function start(transport?: Transport): Promise<AddressInfo> {
  const root = mkdtempSync(join(tmpdir(), "hai-open-data-bridge-"));
  bridge = createBridge({
    host: "127.0.0.1",
    port: 0,
    allowedOrigins: [ORIGIN],
    version: "t",
    token: TOKEN,
    settingsFile: join(root, ".hai", "settings.json"),
    scene: { projectDir: join(root, "project"), saveDelayMs: 50 },
    ...(transport ? { openData: { transport, gapMs: 0 } } : {}),
  });
  return bridge.start();
}

async function mcp(address: AddressInfo, caller: Caller = { agent: "urban", tools: null }) {
  if (!bridge) throw new Error("no bridge");
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${bridge.agentTokens.issue(caller)}` } },
  });
  await client.connect(transport);
  clients.push(client);
  return client;
}

const page = (address: AddressInfo) =>
  connectClient(address, { token: TOKEN, origin: ORIGIN, track: sockets });
const textOf = (result: { content?: unknown }) =>
  (result.content as Array<{ text?: string }> | undefined)?.[0]?.text ?? "";
const names = async (client: Client) => (await client.listTools()).tools.map((t) => t.name);

describe("Open data tools", () => {
  it("while Open data is off no open-data tool is offered, so none can be called", async () => {
    const address = await start();
    const agent = await mcp(address);
    const listed = await names(agent);
    expect(listed).not.toContain("open_data_sources");
    expect(listed).not.toContain("site_set");
    await expect(agent.callTool({ name: "open_data_sources", arguments: {} })).rejects.toThrow(/not found/);
  });

  it("switched on, an agent whose role has them is offered them, and another is not", async () => {
    const address = await start();
    const browser = await page(address);
    browser.send("settings.set", { features: { openData: true } });
    await browser.waitFor("settings.snapshot", (m) => m.payload.features?.openData === true);
    const urban = await mcp(address, { agent: "urban", tools: new Set(["open_data_sources", "site_set"]) });
    const reviewer = await mcp(address, { agent: "reviewer", tools: new Set(["get_elements"]) });
    expect(await names(urban)).toEqual(expect.arrayContaining(["open_data_sources", "site_set"]));
    expect(await names(reviewer)).not.toContain("open_data_sources");
  });

  it("open_data_sources lists the sources with their hosts and licences, says a source with a limit is off, and that there is no site", async () => {
    const address = await start();
    const browser = await page(address);
    browser.send("settings.set", { features: { openData: true } });
    await browser.waitFor("settings.snapshot", (m) => m.payload.features?.openData === true);
    const agent = await mcp(address);
    const told = JSON.parse(textOf(await agent.callTool({ name: "open_data_sources", arguments: {} })));
    expect(told.site).toBeNull();
    expect(told.note).toMatch(/site_set/);
    const byId = Object.fromEntries(told.sources.map((s: { id: string }) => [s.id, s]));
    expect(byId["met-norway"]).toMatchObject({ on: true, hosts: ["api.met.no"] });
    expect(byId["open-meteo"]).toMatchObject({ on: false });
    expect(byId["open-meteo"].why).toMatch(/non-commercial/);
    expect(byId.portals.hosts).toContain("catalog.data.gov");
  });

  it("site_set saves the site, tells every page, and open_data_sources then reports it", async () => {
    const address = await start();
    const browser = await page(address);
    browser.send("settings.set", { features: { openData: true } });
    await browser.waitFor("settings.snapshot", (m) => m.payload.features?.openData === true);
    const agent = await mcp(address);
    const saved = await agent.callTool({
      name: "site_set",
      arguments: { latitude: 52.37, longitude: 4.9, north_deg: 10 },
    });
    expect(saved.isError).toBeFalsy();
    const snapshot = await browser.waitFor("site.snapshot", (m) => m.payload.site !== null);
    expect(snapshot.payload.site).toMatchObject({ lat: 52.37, lon: 4.9, northDeg: 10, anchorMm: [0, 0] });
    const told = JSON.parse(textOf(await agent.callTool({ name: "open_data_sources", arguments: {} })));
    expect(told.site).toMatchObject({ lat: 52.37 });
    expect(bridge?.site.site).toMatchObject({ lon: 4.9 });
  });

  it("site_set refuses an impossible place before anything is saved", async () => {
    const address = await start();
    const browser = await page(address);
    browser.send("settings.set", { features: { openData: true } });
    await browser.waitFor("settings.snapshot", (m) => m.payload.features?.openData === true);
    const agent = await mcp(address);
    const refused = await agent
      .callTool({ name: "site_set", arguments: { latitude: 120, longitude: 4.9 } })
      .then(
        (r) => textOf(r),
        (e: Error) => e.message,
      );
    expect(refused).toMatch(/latitude|90/i);
    expect(bridge?.site.site).toBeNull();
  });

  it("a page sets and clears the site itself, and a new page is greeted with it", async () => {
    const address = await start();
    const browser = await page(address);
    browser.send("site.set", { site: { lat: 40, lon: -3 } });
    await browser.waitFor("site.snapshot", (m) => m.payload.site?.lat === 40);
    const later = await page(address);
    expect((await later.waitFor("site.snapshot")).payload.site).toMatchObject({ lat: 40, lon: -3 });
    browser.send("site.set", { site: null });
    await vi.waitFor(() => expect(bridge?.site.site).toBeNull());
  });

  it("every request is in the record a page receives, and a page can clear it", async () => {
    const answers: string[] = [];
    const transport: Transport = async (url) => {
      answers.push(url.href);
      return { status: 200, headers: { "content-type": "application/json" }, body: Buffer.from("{}") };
    };
    const address = await start(transport);
    const browser = await page(address);
    browser.send("settings.set", { features: { openData: true } });
    await browser.waitFor("settings.snapshot", (m) => m.payload.features?.openData === true);
    await bridge?.openData.client.request({
      source: "met-norway",
      kind: "weather",
      url: "https://api.met.no/x",
      ttlMs: 0,
    });
    const record = await browser.waitFor("opendata.record", (m) => m.payload.entries.length === 1);
    expect(record.payload.entries[0]).toMatchObject({
      source: "met-norway",
      host: "api.met.no",
      kind: "weather",
    });
    browser.send("opendata.clear", {});
    await browser.waitFor("opendata.record", (m) => m.payload.entries.length === 0);
    expect(answers).toEqual(["https://api.met.no/x"]);
  });

  it("switching Open data off ends a request in flight and refuses the next", async () => {
    const transport: Transport = (_url, init) =>
      new Promise((_resolve, reject) =>
        init.signal.addEventListener("abort", () => reject(init.signal.reason)),
      );
    const address = await start(transport);
    const browser = await page(address);
    browser.send("settings.set", { features: { openData: true } });
    await browser.waitFor("settings.snapshot", (m) => m.payload.features?.openData === true);
    const pending = bridge?.openData.client.request({
      source: "met-norway",
      kind: "weather",
      url: "https://api.met.no/x",
      ttlMs: 0,
    });
    const settled = pending?.then(
      () => "answered",
      (e: { code: string }) => e.code,
    );
    await new Promise((r) => setTimeout(r, 30));
    browser.send("settings.set", { features: { openData: false } });
    expect(await settled).toBe("off");
    await expect(
      bridge?.openData.client.request({
        source: "met-norway",
        kind: "weather",
        url: "https://api.met.no/y",
        ttlMs: 0,
      }),
    ).rejects.toMatchObject({ code: "off" });
  });
});

describe("site_set asks the user every time", () => {
  const approvals = () => {
    const sent: unknown[] = [];
    const broker = new ApprovalBroker({ projectDir: () => null }, (m) => sent.push(m));
    return { broker, sent };
  };

  it("is never pre-approved, even when 'Always allow' lists it, and its card has no Always allow", async () => {
    const { broker, sent } = approvals();
    expect(broker.isPreApproved("mcp__hai__site_set")).toBe(false);
    expect(broker.isPreApproved("mcp__hai__open_data_sources")).toBe(true);
    const decision = broker.decide(
      "mcp__hai__site_set",
      { latitude: 52.37, longitude: 4.9, north_deg: 10 },
      "t1",
      "urban",
    );
    const card = (sent[0] as { payload: { summary: string; once?: boolean; agent: string } }).payload;
    expect(card.once).toBe(true);
    expect(card.summary).toBe(
      "Set the project's site to latitude 52.37, longitude 4.9, true north 10 degrees from +Y",
    );
    expect(card.agent).toBe("urban");
    broker.denyAll("no");
    await expect(decision).resolves.toMatchObject({ behavior: "deny" });
  });
});
