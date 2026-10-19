import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "./envelope.ts";
import { parseMessage } from "./messages.ts";

const hello = { type: "hello", id: "m1", payload: { client: "web", protocolVersion: PROTOCOL_VERSION } };
const status = {
  type: "bridge.status",
  id: "m2",
  payload: {
    protocolVersion: PROTOCOL_VERSION,
    bridgeVersion: "0.0.0",
    startedAt: "2026-10-19T10:00:00.000Z",
    clients: 1,
  },
};

describe("parseMessage", () => {
  it("accepts a valid hello", () => {
    const result = parseMessage(JSON.stringify(hello));
    expect(result).toEqual({ ok: true, message: hello });
  });

  it("accepts a valid bridge.status", () => {
    expect(parseMessage(JSON.stringify(status)).ok).toBe(true);
  });

  it.each([
    ["not JSON", "{oops"],
    ["missing id", JSON.stringify({ type: "hello", payload: hello.payload })],
    ["unknown type", JSON.stringify({ ...hello, type: "launch.missiles" })],
    ["extra envelope key", JSON.stringify({ ...hello, extra: true })],
    ["extra payload key", JSON.stringify({ ...hello, payload: { ...hello.payload, extra: 1 } })],
    [
      "wrong protocol version",
      JSON.stringify({ ...hello, payload: { ...hello.payload, protocolVersion: 99 } }),
    ],
    ["negative client count", JSON.stringify({ ...status, payload: { ...status.payload, clients: -1 } })],
    ["bad timestamp", JSON.stringify({ ...status, payload: { ...status.payload, startedAt: "yesterday" } })],
  ])("rejects %s", (_label, raw) => {
    const result = parseMessage(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });
});
