import { z } from "zod";
import { RhinoPythonStatus } from "./rhino.ts";

/** Bumped whenever a message shape changes incompatibly. */
export const PROTOCOL_VERSION = 1;

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

/** What the Rhino plugin tells the bridge about itself when it connects. */
export const RhinoHello = z.strictObject({
  client: z.literal("rhino"),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  rhinoVersion: z.string().max(40),
  pluginVersion: z.string().max(40),
  python: RhinoPythonStatus,
  /** The open document's name, or null for an unsaved one. */
  document: z.string().max(260).nullable(),
});
export type RhinoHello = z.infer<typeof RhinoHello>;

/** First message a client sends after connecting: a browser page, or the Rhino plugin. */
export const HelloMessage = z.strictObject({
  type: z.literal("hello"),
  id: MessageId,
  payload: z.discriminatedUnion("client", [WebHello, RhinoHello]),
});
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
