import { z } from "zod";
import { HostApp, HostCapabilities, HostId, HostRunStatus } from "./host.ts";

/** Bumped whenever a message shape changes incompatibly. */
export const PROTOCOL_VERSION = 2;

/** WebSocket path and subprotocol the bridge speaks. Browsers cannot set headers on a WebSocket, so the
 *  session token travels as a second subprotocol entry: `hai.token.<token>`. */
export const WS_PATH = "/ws";
export const WS_PROTOCOL = "hai.v1";
export const TOKEN_PROTOCOL_PREFIX = "hai.token.";

export const MessageId = z.string().min(1).max(64);

/** Every message on the wire: a type tag, an id for correlation, and a typed payload. */
export const Envelope = z.strictObject({
  type: z.string().min(1).max(64),
  id: MessageId,
  payload: z.unknown(),
});
export type Envelope = z.infer<typeof Envelope>;

const WebHello = z.strictObject({
  client: z.literal("web"),
  protocolVersion: z.literal(PROTOCOL_VERSION),
});

/** What a host's connector tells the bridge about itself when it connects. */
export const HostHello = z.strictObject({
  client: HostId,
  protocolVersion: z.literal(PROTOCOL_VERSION),
  app: HostApp,
  connectorVersion: z.string().max(40),
  run: HostRunStatus,
  /** The open document's name, or null for an unsaved one. */
  document: z.string().max(260).nullable(),
  capabilities: HostCapabilities,
});
export type HostHello = z.infer<typeof HostHello>;

/** First message a client sends after connecting: a browser page, or a host's connector. */
export const HelloMessage = z.strictObject({
  type: z.literal("hello"),
  id: MessageId,
  payload: z.union([WebHello, HostHello]),
});

/**
 * A hello from a host's connector built for an older protocol, so the bridge can tell it to update instead of only
 * closing. Read loosely: an old connector's other fields are not this protocol's.
 */
export function olderHostHello(raw: unknown): HostId | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { type, payload } = raw as { type?: unknown; payload?: unknown };
  if (type !== "hello" || typeof payload !== "object" || payload === null) return null;
  const { client, protocolVersion } = payload as { client?: unknown; protocolVersion?: unknown };
  const host = HostId.safeParse(client);
  if (!host.success) return null;
  return typeof protocolVersion === "number" && protocolVersion < PROTOCOL_VERSION ? host.data : null;
}
export type HelloMessage = z.infer<typeof HelloMessage>;

/** Sent by the bridge in reply to hello, and whenever its state changes. */
export const BridgeStatusMessage = z.strictObject({
  type: z.literal("bridge.status"),
  id: MessageId,
  payload: z.strictObject({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    bridgeVersion: z.string().min(1),
    startedAt: z.iso.datetime(),
    clients: z.int().nonnegative(),
  }),
});
export type BridgeStatusMessage = z.infer<typeof BridgeStatusMessage>;
