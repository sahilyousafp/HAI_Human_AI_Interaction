import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import {
  type HostBatch,
  type HostCapabilities,
  type HostId,
  type HostObject,
  type Message,
  PROTOCOL_VERSION,
  parseMessage,
  TOKEN_PROTOCOL_PREFIX,
  WS_PATH,
  WS_PROTOCOL,
} from "@hai/protocol";
import { encodeMeshAsset } from "@hai/scene";
import { WebSocket } from "ws";

const APPS: Record<HostId, { name: string; version: string }> = {
  rhino: { name: "Rhino 8", version: "8.36.0" },
  blender: { name: "Blender", version: "5.1.0" },
  revit: { name: "Revit 2026", version: "26.0" },
};

export const ALL_CAPABILITIES: HostCapabilities = {
  languages: ["python"],
  capture: true,
  placeImage: true,
  apiLookup: true,
  describe: true,
};

/** A one-pixel PNG, the smallest a fake host can upload as its capture. */
export const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * A stand-in for a host's connector: connects the way a local program does (the token, no Origin) and says hello as
 * the host. `send` adds the host to a `host.*` payload that does not name one, so tests read like the connector's own
 * messages.
 */
export async function connectFakeHost(
  address: AddressInfo,
  options: {
    token: string;
    host?: HostId;
    run?: { state: "ready" } | { state: "unavailable"; reason: string };
    document?: string | null;
    capabilities?: Partial<HostCapabilities>;
    track?: WebSocket[];
  },
) {
  const host = options.host ?? "rhino";
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
  const send = (type: string, payload: unknown) => {
    const named =
      type.startsWith("host.") && payload && typeof payload === "object" && !("host" in payload)
        ? { host, ...payload }
        : payload;
    ws.send(JSON.stringify({ type, id: randomUUID(), payload: named }));
  };
  send("hello", {
    client: host,
    protocolVersion: PROTOCOL_VERSION,
    app: APPS[host],
    connectorVersion: "0.2.0",
    run: options.run ?? { state: "ready" },
    document: options.document ?? "tower.3dm",
    capabilities: {
      ...ALL_CAPABILITIES,
      ...(host === "revit" ? { languages: ["csharp"] } : {}),
      ...options.capabilities,
    },
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

  /** Uploads a one-triangle mesh as an asset (its corner at `at`, millimetres), the way a connector does before it names the asset in a batch. */
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
    const res = await fetch(`http://127.0.0.1:${address.port}/mirror/${host}/${id}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${options.token}`, "content-type": "application/octet-stream" },
      body: new Uint8Array(bytes),
    });
    if (res.status !== 204) throw new Error(`upload answered ${res.status}`);
    return id;
  }

  /** Uploads a capture of the viewport, the way a connector does before it answers `host.capture`. */
  async function uploadCapture(png: Buffer = TINY_PNG): Promise<string> {
    const id = randomUUID();
    const res = await fetch(`http://127.0.0.1:${address.port}/captures/${id}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${options.token}`, "content-type": "image/png" },
      body: new Uint8Array(png),
    });
    if (res.status !== 204) throw new Error(`capture upload answered ${res.status}`);
    return id;
  }

  return { ws, host, send, waitFor, received, uploadMesh, uploadCapture };
}

/** A host object descriptor for a batch. */
export function hostObject(id: string, asset: string | null, extra: Partial<HostObject> = {}): HostObject {
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

export function hostBatch(partial: Partial<HostBatch> = {}): HostBatch {
  return {
    changed: [],
    deleted: [],
    notDrawn: { curves: 0, points: 0, annotations: 0, other: 0, heavy: 0, simplified: 0 },
    sync: null,
    reset: false,
    changedAt: Date.now(),
    ...partial,
  };
}
