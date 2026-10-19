import { z } from "zod";

/** Bumped whenever a message shape changes incompatibly. */
export const PROTOCOL_VERSION = 1;

/** WebSocket path and subprotocol the bridge speaks. Browsers cannot set headers on a WebSocket, so the
 *  session token travels as a second subprotocol entry: `aex.token.<token>`. */
export const WS_PATH = "/ws";
export const WS_PROTOCOL = "aex.v1";
export const TOKEN_PROTOCOL_PREFIX = "aex.token.";

export const MessageId = z.string().min(1).max(64);

/** Every message on the wire: a type tag, an id for correlation, and a typed payload. */
export const Envelope = z.strictObject({
  type: z.string().min(1).max(64),
  id: MessageId,
  payload: z.unknown(),
});
export type Envelope = z.infer<typeof Envelope>;

/** First message a client sends after connecting. */
export const HelloMessage = z.strictObject({
  type: z.literal("hello"),
  id: MessageId,
  payload: z.strictObject({
    client: z.literal("web"),
    protocolVersion: z.literal(PROTOCOL_VERSION),
  }),
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
