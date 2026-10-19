import { z } from "zod";

/** Normalised [x, y] (0..1), mirrored to match what the user sees in the preview. */
export const Point2 = z.tuple([z.number(), z.number()]);
export type Point2 = z.infer<typeof Point2>;

export const Hand = z.enum(["Left", "Right"]);
export type Hand = z.infer<typeof Hand>;

/** Every gesture event carries the capture timestamp (epoch ms) of the frame that produced it. */
const base = {
  ts: z.number().positive(),
  confidence: z.number().min(0).max(1),
};
const handed = { ...base, hand: Hand };
const twoHand = {
  ...base,
  hand: z.literal("both"),
  /** Distance between the two pinch points, normalised to the frame width. */
  distance: z.number().nonnegative(),
  midpoint: Point2,
  /** Angle of the line from left to right pinch point, in degrees. */
  angle: z.number(),
};

export const GestureEvent = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("engaged"), ...base }),
  z.strictObject({ type: z.literal("disengaged"), ...base, reason: z.enum(["no-hands", "idle"]) }),
  z.strictObject({ type: z.literal("pinch.tap"), ...handed, position: Point2 }),
  z.strictObject({ type: z.literal("pinch.drag.start"), ...handed, position: Point2 }),
  z.strictObject({ type: z.literal("pinch.drag.update"), ...handed, position: Point2, delta: Point2 }),
  z.strictObject({ type: z.literal("pinch.drag.end"), ...handed, position: Point2 }),
  z.strictObject({ type: z.literal("clutch.start"), ...handed }),
  z.strictObject({ type: z.literal("clutch.end"), ...handed }),
  z.strictObject({ type: z.literal("twohand.start"), ...twoHand }),
  z.strictObject({ type: z.literal("twohand.update"), ...twoHand }),
  z.strictObject({ type: z.literal("twohand.end"), ...twoHand }),
  z.strictObject({ type: z.literal("head.nod"), ...base }),
  z.strictObject({ type: z.literal("head.shake"), ...base }),
]);
export type GestureEvent = z.infer<typeof GestureEvent>;
export type GestureType = GestureEvent["type"];
