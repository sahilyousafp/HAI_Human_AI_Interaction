import { z } from "zod";
import { AssetId, ElementId, Point3Mm } from "./scene.ts";

/** The design applications HAI drives. Each connects through HAI's own connector and models with its own tools. */
export const HostId = z.enum(["rhino", "blender", "revit"]);
export type HostId = z.infer<typeof HostId>;
export const HOST_IDS = HostId.options;

/** Each host's name and how the user connects it, for the HUD and for an agent told it is not connected. */
export const HOST_INFO: Record<HostId, { label: string; connectHint: string }> = {
  rhino: { label: "Rhino", connectHint: "Run HaiConnect in Rhino." },
  blender: {
    label: "Blender",
    connectHint: "Enable the HAI add-on in Blender and press Connect in its panel.",
  },
  revit: { label: "Revit", connectHint: "Load the HAI add-in in Revit and press Connect on its ribbon." },
};

/** The languages a host runs the agent's code in. */
export const HostLanguage = z.enum(["python", "csharp"]);
export type HostLanguage = z.infer<typeof HostLanguage>;

/** Whether the host can run code for the agent now. */
export const HostRunStatus = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("ready") }),
  z.strictObject({ state: z.literal("unavailable"), reason: z.string().max(500) }),
]);
export type HostRunStatus = z.infer<typeof HostRunStatus>;

/** The application on the other end of the connector. */
export const HostApp = z.strictObject({
  /** As the application names itself, "Rhino 8", "Blender", "Revit 2026". */
  name: z.string().min(1).max(60),
  version: z.string().min(1).max(40),
});
export type HostApp = z.infer<typeof HostApp>;

/** What a host's connector can do, from its hello. */
export const HostCapabilities = z.strictObject({
  languages: z.array(HostLanguage).max(2),
  capture: z.boolean(),
  placeImage: z.boolean(),
  apiLookup: z.boolean(),
  describe: z.boolean(),
  /** Applies the user's moves, rotations and deletes made in HAI (`host.edit`). False for a connector without it. */
  edit: z.boolean().default(false),
});
export type HostCapabilities = z.infer<typeof HostCapabilities>;

/**
 * The kinds of host object that are meshed and drawn in HAI: Rhino's geometry types, a Blender object and a Revit
 * element. Curves, points and annotations are only counted.
 */
export const HostObjectType = z.enum([
  "brep",
  "extrusion",
  "mesh",
  "surface",
  "subd",
  "block",
  "object",
  "element",
]);
export type HostObjectType = z.infer<typeof HostObjectType>;

const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const HostBounds = z
  .strictObject({ min: Point3Mm, max: Point3Mm })
  .refine(({ min, max }) => min.every((v, i) => v <= (max[i] ?? v)), "min must not exceed max");
export type HostBounds = z.infer<typeof HostBounds>;

const HostTags = z
  .record(z.string().max(64), z.string().max(200))
  .refine((t) => Object.keys(t).length <= 20, "at most 20 tags");

/**
 * One host object as the viewer needs it: who it is, where it is, and the asset that holds its triangles. `asset` is
 * null for an object too heavy to mirror in full: it is drawn as its bounding box. `tags` are the object's `hai.*`
 * properties, the way parts are named for the agents that work on them.
 */
export const HostObject = z.strictObject({
  /** The host's own id for the object: a Rhino or Blender GUID, a Revit unique id. */
  id: ElementId,
  name: z.string().max(200),
  type: HostObjectType,
  /** Where the host files it: a Rhino layer's full path ("Parent::Child"), a Blender collection path, a Revit category. */
  layer: z.string().max(400),
  /** The display colour, or null to use the layer's. */
  color: Color.nullable(),
  /** The bounding box, millimetres, Z up. */
  bounds: HostBounds,
  asset: AssetId.nullable(),
  triangles: z.int().nonnegative(),
  /**
   * A block's or instance's placement: where its asset goes, row by row, millimetres. Every placement of a block shares
   * one asset, in the block's own coordinates. Absent for anything else, whose asset is already in place.
   */
  transform: z.array(z.number()).length(16).optional(),
  /** A block's colour per part of its asset; null where a part takes the object's own `color`. */
  partColors: z.array(Color.nullable()).max(64).optional(),
  tags: HostTags,
});
export type HostObject = z.infer<typeof HostObject>;

/** What the viewer does not draw, so a missing object is explained. */
export const HostNotDrawn = z.strictObject({
  curves: z.int().nonnegative(),
  points: z.int().nonnegative(),
  annotations: z.int().nonnegative(),
  other: z.int().nonnegative(),
  /** Objects drawn as their bounding box because they are over the triangle cap. */
  heavy: z.int().nonnegative(),
  /** Placed blocks drawn, but with less detail, because the model is too heavy to draw in full. */
  simplified: z.int().nonnegative().default(0),
});
export type HostNotDrawn = z.infer<typeof HostNotDrawn>;

export const EMPTY_NOT_DRAWN: HostNotDrawn = {
  curves: 0,
  points: 0,
  annotations: 0,
  other: 0,
  heavy: 0,
  simplified: 0,
};

/** How far the first sync of a document has got. */
export const HostSync = z.strictObject({ done: z.int().nonnegative(), total: z.int().nonnegative() });
export type HostSync = z.infer<typeof HostSync>;

/** A batch of changes in the document: what to add or replace, and what to remove. */
export const HostBatch = z.strictObject({
  changed: z.array(HostObject).max(500),
  deleted: z.array(ElementId).max(2000),
  notDrawn: HostNotDrawn,
  /** Set during the first sync of a document, null once every object is in. */
  sync: HostSync.nullable(),
  /** True for the first batch of a document: everything held so far is dropped first. */
  reset: z.boolean(),
  /** When the connector sent it (epoch ms), so the web app can measure how long a change took to be drawn. */
  changedAt: z.number(),
});
export type HostBatch = z.infer<typeof HostBatch>;

/** A selected host object, with what the agent needs to know about it. */
export const HostSelected = z.strictObject({
  id: ElementId,
  type: z.string().max(40),
  layer: z.string().max(400),
});
export type HostSelected = z.infer<typeof HostSelected>;

/** The most components one description holds: the selection card and a request carry at most this many. */
export const HOST_DESCRIBE_MAX = 50;
/** The most properties one component carries. */
export const HOST_COMPONENT_MAX_PROPERTIES = 100;

/**
 * One component as its host describes it: what it is, how big, of what, and its own properties (Rhino user strings,
 * Blender custom properties and modifiers, Revit parameters with their units).
 */
export const HostComponent = z.strictObject({
  id: ElementId,
  name: z.string().max(200),
  /** The host's own word for it: "Closed Brep", "Mesh", "Basic Wall: Generic - 200mm". */
  type: z.string().max(200),
  layer: z.string().max(400),
  bounds: HostBounds.nullable(),
  /** Whichever apply. Skipped when the host could not work them out quickly; `quantitiesSkipped` says so. */
  quantities: z.strictObject({
    areaMm2: z.number().nonnegative().optional(),
    volumeMm3: z.number().nonnegative().optional(),
    lengthMm: z.number().nonnegative().optional(),
  }),
  quantitiesSkipped: z.boolean().default(false),
  material: z.string().max(200).nullable(),
  properties: z
    .record(z.string().max(120), z.union([z.string().max(200), z.number(), z.boolean()]))
    .refine((p) => Object.keys(p).length <= HOST_COMPONENT_MAX_PROPERTIES, "at most 100 properties"),
});
export type HostComponent = z.infer<typeof HostComponent>;

/** One object a script added, changed or deleted, as far as the bridge needs it to compare with a claim. */
export const HostChange = z.strictObject({
  id: ElementId,
  name: z.string().max(200),
  /** Its `hai.*` properties (a deleted object's as they were). */
  tags: HostTags,
  /** Where it is (a deleted object's as it was); null when it has none. */
  bounds: HostBounds.nullable(),
});
export type HostChange = z.infer<typeof HostChange>;

/** What a script did to the document, found by comparing every object before and after the run. */
export const HostRunChanges = z.strictObject({
  added: z.array(HostChange).max(500),
  changed: z.array(HostChange).max(500),
  deleted: z.array(HostChange).max(500),
  /** More objects changed than are listed. */
  truncated: z.boolean(),
});
export type HostRunChanges = z.infer<typeof HostRunChanges>;

/** The result of a run in a host. Output is capped by the connector. */
export const HostRunResult = z.strictObject({
  id: z.string().min(1).max(64),
  ok: z.boolean(),
  stdout: z.string().max(40_000),
  /** The value of a variable named `result`, as text, if the script set one. */
  result: z.string().max(40_000).optional(),
  /** The error message and the last lines of the traceback. */
  error: z.string().max(10_000).optional(),
  durationMs: z.number().nonnegative(),
  /** What the run added, changed and deleted; absent when the connector could not compare the document. */
  changes: HostRunChanges.optional(),
});
export type HostRunResult = z.infer<typeof HostRunResult>;

/** The most objects one edit names. */
export const HOST_EDIT_MAX_IDS = 2000;

/**
 * An edit the user made in HAI on a host's objects: a transform (a 4 x 4 matrix, row by row, millimetres, Z up, as a
 * block placement is) or a delete, by ids. The host applies it as one undo record; it is never code.
 */
export const HostEditOp = z.discriminatedUnion("op", [
  z.strictObject({
    op: z.literal("transform"),
    ids: z.array(ElementId).min(1).max(HOST_EDIT_MAX_IDS),
    matrix: z.array(z.number().finite()).length(16),
  }),
  z.strictObject({ op: z.literal("delete"), ids: z.array(ElementId).min(1).max(HOST_EDIT_MAX_IDS) }),
]);
export type HostEditOp = z.infer<typeof HostEditOp>;

/** The longest script the bridge sends a host to run. */
export const HOST_MAX_CODE = 200_000;

/** One entry of a host's scripting API, found by reflection inside the running host. */
export const HostApiEntry = z.strictObject({
  /** The full name, "Rhino.Geometry.Brep.CreateFromLoft". */
  name: z.string().min(1).max(300),
  kind: z.enum(["type", "method", "property", "field", "event", "function", "class", "module"]),
  /** Overloads are separate entries. */
  signature: z.string().max(1000),
  summary: z.string().max(1000).optional(),
});
export type HostApiEntry = z.infer<typeof HostApiEntry>;
export const HOST_API_MAX_ENTRIES = 50;

/** Which hosts the user lets the agent use: Settings > Hosts. A host that is off is not drawn or offered. */
export const HostChoices = z.strictObject({
  rhino: z.boolean().default(true),
  blender: z.boolean().default(true),
  revit: z.boolean().default(true),
});
export type HostChoices = z.infer<typeof HostChoices>;
export const ALL_HOSTS_ON: HostChoices = { rhino: true, blender: true, revit: true };
