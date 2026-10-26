import { z } from "zod";
import { PointMm } from "./scene.ts";

/** What the context layer holds at most, so a snapshot stays small enough to send whole. */
export const CONTEXT_MAX_BUILDINGS = 3000;
export const CONTEXT_MAX_TREES = 5000;
export const CONTEXT_MAX_RASTERS = 4;

const itemId = z.string().min(1).max(80);
const source = z.string().min(1).max(40);

/** A building around the site: its footprint (plan, mm, model coordinates) extruded to its height. */
export const ContextBuilding = z.strictObject({
  id: itemId,
  kind: z.literal("building"),
  footprint: z.array(PointMm).min(3).max(400),
  heightMm: z.number().finite().positive().max(1_000_000),
  /** Where the height came from: the source gave it, it was worked out from levels, or it is a plain default. */
  heightSource: z.enum(["measured", "inferred", "default"]),
  /** Height of its base above the origin, mm. */
  baseMm: z.number().finite().default(0),
  source,
  label: z.string().max(120).optional(),
});
export type ContextBuilding = z.infer<typeof ContextBuilding>;

/** A tree, as a point (model coordinates) with a height when the source has one. */
export const ContextTree = z.strictObject({
  id: itemId,
  kind: z.literal("tree"),
  position: PointMm,
  heightMm: z.number().finite().positive().max(100_000).optional(),
  source,
});
export type ContextTree = z.infer<typeof ContextTree>;

/** One colour stop of a raster's legend. */
export const ContextLegendStop = z.strictObject({ value: z.number().finite(), color: z.string().max(20) });

/** Ground data (vegetation cover, ground temperature) as a coloured image laid on the ground over a box. */
export const ContextRaster = z.strictObject({
  id: itemId,
  kind: z.literal("raster"),
  label: z.string().min(1).max(120),
  quantity: z.string().min(1).max(60),
  unit: z.string().max(20),
  source,
  /** When the data was observed (ISO 8601). */
  date: z.string().max(40),
  minMm: PointMm,
  maxMm: PointMm,
  /** A PNG data URL, drawn on the ground. */
  image: z.string().startsWith("data:image/png;base64,").max(700_000),
  /** The lowest and highest value the colours span. */
  range: z.tuple([z.number().finite(), z.number().finite()]),
  legend: z.array(ContextLegendStop).min(2).max(12),
});
export type ContextRaster = z.infer<typeof ContextRaster>;

export const ContextItem = z.discriminatedUnion("kind", [ContextBuilding, ContextTree, ContextRaster]);
export type ContextItem = z.infer<typeof ContextItem>;

/** Where the context came from and when, for the credits the app shows. */
export const ContextCredit = z.strictObject({
  source: z.string(),
  attribution: z.string(),
  date: z.string().nullable(),
});
export type ContextCredit = z.infer<typeof ContextCredit>;
