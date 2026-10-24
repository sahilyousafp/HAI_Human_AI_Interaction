import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import {
  type Message,
  PROTOCOL_VERSION,
  parseMessage,
  type RhinoBatch,
  type RhinoObject,
  TOKEN_PROTOCOL_PREFIX,
  WS_PATH,
  WS_PROTOCOL,
} from "@hai/protocol";
import { encodeMeshAsset } from "@hai/scene";
import { WebSocket } from "ws";

/** A stand-in for the Rhino plugin: connects the way a local program does (the token, no Origin) and says hello as Rhino. */
export async function connectFakeRhino(
  address: AddressInfo,
  options: {
    token: string;
    python?: { state: "ready" } | { state: "unavailable"; reason: string };
    document?: string | null;
    track?: WebSocket[];
  },
) {
  const ws = new WebSocket(`ws://127.0.0.1:${address.port}${WS_PATH}`, [
    WS_PROTOCOL,
    `${TOKEN_PROTOCOL_PREFIX}${options.token}`,
  ]);
  options.track?.push(ws);
  const received: Message[] = [];
  ws.on("message", (d) => {
    const r = parseMessage(d.toString());
    if (r.ok) received.push(r.message);
  });
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  const send = (type: string, payload: unknown) =>
    ws.send(JSON.stringify({ type, id: randomUUID(), payload }));
  send("hello", {
    client: "rhino",
    protocolVersion: PROTOCOL_VERSION,
    rhinoVersion: "8.12.0",
    pluginVersion: "0.1.0",
    python: options.python ?? { state: "ready" },
    document: options.document ?? "tower.3dm",
  });
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
  await waitFor("bridge.status");

  /** Uploads a one-triangle mesh as an asset (its corner at `at`, millimetres), the way the plugin does before it names the asset in a batch. */
  async function uploadMesh(size = 1000, at: [number, number, number] = [0, 0, 0]): Promise<string> {
    const id = randomUUID();
    const bytes = encodeMeshAsset([
      {
        positions: new Float32Array([
          at[0],
          at[1],
          at[2],
          at[0] + size,
          at[1],
          at[2],
          at[0],
          at[1] + size,
          at[2],
        ]),
        indices: new Uint32Array([0, 1, 2]),
      },
    ]);
    const res = await fetch(`http://127.0.0.1:${address.port}/mirror/${id}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${options.token}`, "content-type": "application/octet-stream" },
      body: new Uint8Array(bytes),
    });
    if (res.status !== 204) throw new Error(`upload answered ${res.status}`);
    return id;
  }

  return { ws, send, waitFor, received, uploadMesh };
}

/** A Rhino object descriptor for a batch. */
export function rhinoObject(id: string, asset: string | null, extra: Partial<RhinoObject> = {}): RhinoObject {
  return {
    id,
    name: `Object ${id}`,
    type: "brep",
    layer: "Default",
    color: null,
    bounds: { min: [0, 0, 0], max: [1000, 1000, 0] },
    asset,
    triangles: asset ? 1 : 0,
    tags: {},
    ...extra,
  };
}

export function rhinoBatch(partial: Partial<RhinoBatch> = {}): RhinoBatch {
  return {
    changed: [],
    deleted: [],
    notDrawn: { curves: 0, points: 0, annotations: 0, other: 0, heavy: 0 },
    sync: null,
    reset: false,
    changedAt: Date.now(),
    ...partial,
  };
}
