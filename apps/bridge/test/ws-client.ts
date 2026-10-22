import type { AddressInfo } from "node:net";
import {
  type Message,
  PROTOCOL_VERSION,
  parseMessage,
  TOKEN_PROTOCOL_PREFIX,
  WS_PATH,
  WS_PROTOCOL,
} from "@hai/protocol";
import { WebSocket } from "ws";

/** A connected, greeted bridge client that records every message it receives. For tests. */
export async function connectClient(
  address: AddressInfo,
  options: { token: string; origin: string; track?: WebSocket[] },
) {
  const ws = new WebSocket(
    `ws://127.0.0.1:${address.port}${WS_PATH}`,
    [WS_PROTOCOL, `${TOKEN_PROTOCOL_PREFIX}${options.token}`],
    { headers: { origin: options.origin } },
  );
  options.track?.push(ws);
  const received: Message[] = [];
  ws.on("message", (d) => {
    const r = parseMessage(d.toString());
    if (r.ok) received.push(r.message);
  });
  await new Promise((r) => ws.once("open", r));
  const send = (type: string, payload: unknown, id = `m${Math.random()}`) =>
    ws.send(JSON.stringify({ type, id, payload }));
  send("hello", { client: "web", protocolVersion: PROTOCOL_VERSION });
  const waitFor = async <T extends Message["type"]>(
    type: T,
    test: (m: Extract<Message, { type: T }>) => boolean = () => true,
    timeoutMs = 2000,
  ) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const hit = received.find(
        (m): m is Extract<Message, { type: T }> =>
          m.type === type && test(m as Extract<Message, { type: T }>),
      );
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`timed out waiting for ${type}`);
  };
  await waitFor("scene.snapshot");
  return { ws, send, waitFor, received };
}
