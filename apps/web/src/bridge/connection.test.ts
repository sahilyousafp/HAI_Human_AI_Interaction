import { PROTOCOL_VERSION } from "@aex/protocol";
import { describe, expect, it } from "vitest";
import { type ConnectionDeps, type ConnectionState, connectToBridge, type SocketLike } from "./connection.ts";

class FakeSocket implements SocketLike {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  constructor(
    public url: string,
    public protocols: string[],
  ) {}
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.onclose?.();
  }
}

function harness(reachable = true) {
  const sockets: FakeSocket[] = [];
  const timers: Array<() => void> = [];
  const states: ConnectionState[] = [];
  const deps: ConnectionDeps = {
    createSocket: (url, protocols) => {
      const s = new FakeSocket(url, protocols);
      sockets.push(s);
      return s;
    },
    probe: async () => reachable,
    setTimer: (fn) => timers.push(fn),
    clearTimer: () => {},
  };
  return { sockets, timers, states, deps, onState: (s: ConnectionState) => states.push(s) };
}

const status = (clients: number) =>
  JSON.stringify({
    type: "bridge.status",
    id: "s1",
    payload: {
      protocolVersion: PROTOCOL_VERSION,
      bridgeVersion: "0.0.0",
      startedAt: new Date().toISOString(),
      clients,
    },
  });

describe("connectToBridge", () => {
  it("reports no-session when the bridge has not written a session", () => {
    const h = harness();
    connectToBridge(null, h.deps, h.onState);
    expect(h.states).toEqual([{ status: "no-session" }]);
  });

  it("sends the token as a subprotocol and hello on open, then reports connected", () => {
    const h = harness();
    connectToBridge({ port: 4870, token: "abc" }, h.deps, h.onState);
    const socket = h.sockets[0];
    expect(socket?.url).toBe("ws://127.0.0.1:4870/ws");
    expect(socket?.protocols).toEqual(["aex.v1", "aex.token.abc"]);
    socket?.onopen?.();
    expect(JSON.parse(socket?.sent[0] ?? "{}")).toMatchObject({ type: "hello", payload: { client: "web" } });
    socket?.onmessage?.({ data: status(1) });
    expect(h.states.at(-1)).toEqual({ status: "connected", clients: 1, bridgeVersion: "0.0.0" });
  });

  it("reports refused when the upgrade fails but the bridge answers /health", async () => {
    const h = harness(true);
    connectToBridge({ port: 4870, token: "bad" }, h.deps, h.onState);
    h.sockets[0]?.onclose?.();
    await Promise.resolve();
    expect(h.states.at(-1)).toEqual({ status: "refused" });
    expect(h.timers).toHaveLength(1);
  });

  it("reports offline when the bridge is unreachable, and retries", async () => {
    const h = harness(false);
    connectToBridge({ port: 4870, token: "abc" }, h.deps, h.onState);
    h.sockets[0]?.onclose?.();
    await Promise.resolve();
    expect(h.states.at(-1)).toEqual({ status: "offline" });
    h.timers[0]?.();
    expect(h.sockets).toHaveLength(2);
    expect(h.states.at(-1)).toEqual({ status: "connecting" });
  });

  it("defers closing a still-connecting socket until it opens", () => {
    const h = harness();
    const dispose = connectToBridge({ port: 4870, token: "abc" }, h.deps, h.onState);
    const socket = h.sockets[0];
    let closed = false;
    if (socket)
      socket.close = () => {
        closed = true;
      };
    dispose();
    expect(closed).toBe(false);
    socket?.onopen?.();
    expect(closed).toBe(true);
    expect(socket?.sent).toEqual([]);
  });

  it("stops reconnecting after dispose", () => {
    const h = harness();
    const dispose = connectToBridge({ port: 4870, token: "abc" }, h.deps, h.onState);
    h.sockets[0]?.onopen?.();
    dispose();
    expect(h.timers).toHaveLength(0);
  });
});
