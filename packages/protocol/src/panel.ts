import { z } from "zod";
import { MessageId } from "./envelope.ts";
import { ElementId, SceneOp } from "./scene.ts";

/** The largest panel document the agent may supply, in bytes. */
export const PANEL_MAX_BYTES = 256 * 1024;
/** How many messages a panel may send per second; the rest are dropped. */
export const PANEL_MAX_MESSAGES_PER_SECOND = 60;
/** How long an offer waits for an answer before it expires, ms. */
export const PANEL_OFFER_TIMEOUT_MS = 60_000;

/** One self-contained HTML document, at most 256 KB (counted in bytes, not characters). */
export const PanelHtml = z
  .string()
  .min(1)
  .refine((html) => new TextEncoder().encode(html).length <= PANEL_MAX_BYTES, {
    message: `The panel document is limited to ${PANEL_MAX_BYTES / 1024} KB`,
  });

/** The panel's size in CSS pixels; the shell keeps it inside the window. */
export const PanelSize = {
  width: z.int().min(200).max(720),
  height: z.int().min(120).max(720),
};

/** What the agent supplies: the document with a title and a size. */
export const PanelDocument = z.strictObject({
  title: z.string().trim().min(1).max(80),
  ...PanelSize,
  html: PanelHtml,
});
export type PanelDocument = z.infer<typeof PanelDocument>;

/** Where an offer stands. `unused` is an accepted offer whose turn ended without a panel. */
export const PanelOfferState = z.enum(["waiting", "accepted", "skipped", "expired", "unused"]);
export type PanelOfferState = z.infer<typeof PanelOfferState>;

/** How a panel ended: its preview was committed (Done) or thrown away. */
export const PanelOutcome = z.enum(["kept", "discarded"]);
export type PanelOutcome = z.infer<typeof PanelOutcome>;

/** The panel's identity on the wire: one id per panel and per offer, from the bridge. */
export const PanelId = MessageId;

/** Which elements a panel asks for; the same filters as the agent's get_elements. */
export const PanelQuery = z.strictObject({
  ids: z.array(ElementId).max(500).optional(),
  type: z.enum(["massing", "slab", "wall", "column", "line", "imported"]).optional(),
  level: ElementId.optional(),
});
export type PanelQuery = z.infer<typeof PanelQuery>;

/** At most this many operations in one preview. */
export const PANEL_MAX_OPS = 500;

/**
 * What a panel may send to the host through its one message port. Every field is checked before anything happens:
 * operations use the same schema as every other edit, and anything else is dropped.
 */
export const PanelEvent = z.discriminatedUnion("type", [
  /** The runtime is ready (after the handshake). */
  z.strictObject({ type: z.literal("ready") }),
  /** The document threw while loading or running. */
  z.strictObject({ type: z.literal("error"), message: z.string().max(2000) }),
  /** Replaces the panel's preview with this set of operations (empty clears it). */
  z.strictObject({ type: z.literal("preview"), ops: z.array(SceneOp).max(PANEL_MAX_OPS) }),
  /** Keeps the current preview as one undo step and stays open. */
  z.strictObject({ type: z.literal("commit") }),
  /** Reads elements of the committed scene (with the preview over them). */
  z.strictObject({ type: z.literal("get"), requestId: z.string().min(1).max(64), query: PanelQuery }),
  /** The reply to a hand press: whether a control was under the point. */
  z.strictObject({ type: z.literal("pressed"), hit: z.boolean() }),
  /** A key the user pressed while the panel had focus that the host acts on. */
  z.strictObject({ type: z.literal("key"), key: z.literal("Escape") }),
]);
export type PanelEvent = z.infer<typeof PanelEvent>;
