import type { AddressInfo } from "node:net";
import { PROTOCOL_VERSION, TOKEN_PROTOCOL_PREFIX, WS_PATH, WS_PROTOCOL } from "@aex/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { assertLoopback, loadConfig } from "./config.ts";
import { type Bridge, createBridge } from "./server.ts";

const ORIGIN = "http://localhost:5173";
const TOKEN = "test-token-0123456789";

let bridge: Bridge;
let address: AddressInfo;

beforeEach(async () => {
  bridge = createBridge({
    host: "127.0.0.1",
    port: 0,
    allowedOrigins: [ORIGIN],
    version: "test",
    token: TOKEN,
  });
  address = await bridge.start();
});

afterEach(async () => {
  await bridge.stop();
});

function connect(opts: { token?: string; origin?: string }) {
  const protocols = [WS_PROTOCOL, ...(opts.token ? [`${TOKEN_PROTOCOL_PREFIX}${opts.token}`] : [])];
  const headers = opts.origin ? { origin: opts.origin } : {};
  return new WebSocket(`ws://127.0.0.1:${address.port}${WS_PATH}`, protocols, { headers });
}

/** Resolves with the HTTP status of a refused upgrade, or "open" if it was accepted. */
function outcome(ws: WebSocket): Promise<number | "open"> {
  return new Promise((resolve) => {
    ws.once("open", () => {
      resolve("open");
      ws.close();
    });
    ws.once("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
    ws.once("error", () => {});
  });
}

describe("bridge access control", () => {
  it("accepts the right token from an allowed origin", async () => {
    expect(await outcome(connect({ token: TOKEN, origin: ORIGIN }))).toBe("open");
  });

  it("refuses a connection without a token", async () => {
    expect(await outcome(connect({ origin: ORIGIN }))).toBe(401);
  });

  it("refuses a wrong token", async () => {
    expect(await outcome(connect({ token: "wrong-token-0123456789", origin: ORIGIN }))).toBe(401);
  });

  it("refuses a foreign origin even with the right token", async () => {
    expect(await outcome(connect({ token: TOKEN, origin: "https://evil.example" }))).toBe(403);
  });

  it("refuses a connection with no origin", async () => {
    expect(await outcome(connect({ token: TOKEN }))).toBe(403);
  });
});

describe("bridge protocol", () => {
  it("answers hello with bridge.status", async () => {
    const ws = connect({ token: TOKEN, origin: ORIGIN });
    await new Promise((r) => ws.once("open", r));
    const reply = new Promise<unknown>((r) => ws.once("message", (d) => r(JSON.parse(d.toString()))));
    ws.send(
      JSON.stringify({
        type: "hello",
        id: "h1",
        payload: { client: "web", protocolVersion: PROTOCOL_VERSION },
      }),
    );
    expect(await reply).toMatchObject({
      type: "bridge.status",
      payload: { clients: 1, bridgeVersion: "test" },
    });
    ws.close();
  });

  it("closes the connection on a malformed message", async () => {
    const ws = connect({ token: TOKEN, origin: ORIGIN });
    await new Promise((r) => ws.once("open", r));
    const closed = new Promise<number>((r) => ws.once("close", (code) => r(code)));
    ws.send("not json");
    expect(await closed).toBe(1008);
  });
});

describe("loopback only", () => {
  it("listens on 127.0.0.1", () => {
    expect(address.address).toBe("127.0.0.1");
  });

  it.each(["0.0.0.0", "::", "192.168.1.10", "localhost"])("refuses to listen on %s", (host) => {
    expect(() => assertLoopback(host)).toThrow(/only listens on 127\.0\.0\.1/);
    expect(() => createBridge({ host, port: 0, allowedOrigins: [ORIGIN], version: "t" })).toThrow();
    expect(() => loadConfig({ AEX_HOST: host })).toThrow();
  });
});
