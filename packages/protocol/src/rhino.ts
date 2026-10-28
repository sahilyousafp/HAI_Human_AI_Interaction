import { z } from "zod";
import { AssetId, ElementId, Point3Mm } from "./scene.ts";

/** How the agent models: with Rhino when it is connected (auto), always with Rhino, or only with the Python workbench. */
export const ModellingMode = z.enum(["auto", "rhino", "python"]);
export type ModellingMode = z.infer<typeof ModellingMode>;

/** Which of the two the agent actually has now. */
export const ModellingInUse = z.enum(["rhino", "python"]);
export type ModellingInUse = z.infer<typeof ModellingInUse>;

/** Whether Rhino can run Python 3 for the agent. */
export const RhinoPythonStatus = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("ready") }),
  z.strictObject({ state: z.literal("unavailable"), reason: z.string().max(500) }),
]);
export type RhinoPythonStatus = z.infer<typeof RhinoPythonStatus>;

/** The kinds of Rhino object that are meshed and drawn in HAI. Curves, points and annotations are only counted. */
export const RhinoObjectType = z.enum(["brep", "extrusion", "mesh", "surface", "subd"]);
export type RhinoObjectType = z.infer<typeof RhinoObjectType>;

/**
 * One Rhino object as the viewer needs it: who it is, where it is, and the asset that holds its triangles. `asset` is
 * null for an object too heavy to mirror in full: it is drawn as its bounding box. `tags` are the object's `hai.*`
 * user strings, the way parts are named for the agents that work on them.
 */
export const RhinoObject = z.strictObject({
  /** The Rhino object id (a GUID). */
  id: ElementId,
  name: z.string().max(200),
  type: RhinoObjectType,
  /** The layer's full path, "Parent::Child". */
  layer: z.string().max(400),
  /** The display colour, #rrggbb, or null to use the layer's. */
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable(),
  /** The bounding box, millimetres, Z up. */
  bounds: z
    .strictObject({ min: Point3Mm, max: Point3Mm })
    .refine(({ min, max }) => min.every((v, i) => v <= (max[i] ?? v)), "min must not exceed max"),
  asset: AssetId.nullable(),
  triangles: z.int().nonnegative(),
  tags: z
    .record(z.string().max(64), z.string().max(200))
    .refine((t) => Object.keys(t).length <= 20, "at most 20 tags"),
});
export type RhinoObject = z.infer<typeof RhinoObject>;

/** What the viewer does not draw, so a missing object is explained. */
export const RhinoNotDrawn = z.strictObject({
  curves: z.int().nonnegative(),
  points: z.int().nonnegative(),
  annotations: z.int().nonnegative(),
  other: z.int().nonnegative(),
  /** Objects drawn as their bounding box because they are over the triangle cap. */
  heavy: z.int().nonnegative(),
});
export type RhinoNotDrawn = z.infer<typeof RhinoNotDrawn>;

export const EMPTY_NOT_DRAWN: RhinoNotDrawn = { curves: 0, points: 0, annotations: 0, other: 0, heavy: 0 };

/** How far the first sync of a document has got. */
export const RhinoSync = z.strictObject({ done: z.int().nonnegative(), total: z.int().nonnegative() });
export type RhinoSync = z.infer<typeof RhinoSync>;

/** A batch of changes in the document: what to add or replace, and what to remove. */
export const RhinoBatch = z.strictObject({
  changed: z.array(RhinoObject).max(500),
  deleted: z.array(ElementId).max(2000),
  notDrawn: RhinoNotDrawn,
  /** Set during the first sync of a document, null once every object is in. */
  sync: RhinoSync.nullable(),
  /** True for the first batch of a document: everything held so far is dropped first. */
  reset: z.boolean(),
  /** When the plugin sent it (epoch ms), so the web app can measure how long a change took to be drawn. */
  changedAt: z.number(),
});
export type RhinoBatch = z.infer<typeof RhinoBatch>;

/** The selected Rhino objects, with what the agent needs to know about each. */
export const RhinoSelected = z.strictObject({
  id: ElementId,
  type: z.string().max(40),
  layer: z.string().max(400),
});
export type RhinoSelected = z.infer<typeof RhinoSelected>;

/** The ways the viewer looks at the model: the turntable perspective, and six true orthographic views. */
export const VIEW_MODES = ["perspective", "top", "bottom", "front", "back", "left", "right"] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

/** The camera the agent asks for. At least one thing must be given; what is left out stays as it is. */
export const ViewRequest = z
  .strictObject({
    requestId: z.string().min(1).max(64).optional(),
    /** Degrees around the target, counter-clockwise from east (+X): 90 looks from the north, 225 from the south-west. */
    azimuth: z.number().finite().optional(),
    /** Degrees above the horizon, 5 to 89. */
    elevation: z.number().finite().min(5).max(89).optional(),
    /** Millimetres from the target. */
    distance: z.number().finite().positive().optional(),
    target: Point3Mm.optional(),
    /** Elements (or mirrored Rhino objects) to frame. */
    frame: z.array(ElementId).min(1).max(200).optional(),
    /** A named view, as the view cube's faces: an orthographic view, or back to perspective. */
    view: z.enum(VIEW_MODES).optional(),
  })
  .refine(
    (v) => v.view === undefined || (v.azimuth === undefined && v.elevation === undefined),
    "A named view sets the direction itself: leave out azimuth and elevation",
  )
  .refine(
    (v) =>
      v.view !== undefined ||
      v.azimuth !== undefined ||
      v.elevation !== undefined ||
      v.distance !== undefined ||
      v.target !== undefined ||
      v.frame !== undefined,
    "Give at least one of view, azimuth, elevation, distance, target or frame",
  );
export type ViewRequest = z.infer<typeof ViewRequest>;

const RhinoBounds = z
  .strictObject({ min: Point3Mm, max: Point3Mm })
  .refine(({ min, max }) => min.every((v, i) => v <= (max[i] ?? v)), "min must not exceed max");

/** One object a script added, changed or deleted, as far as the bridge needs it to compare with a claim. */
export const RhinoChange = z.strictObject({
  id: ElementId,
  name: z.string().max(200),
  /** Its `hai.*` user strings (a deleted object's as they were). */
  tags: z
    .record(z.string().max(64), z.string().max(200))
    .refine((t) => Object.keys(t).length <= 20, "at most 20 tags"),
  /** Where it is (a deleted object's as it was); null when it has none. */
  bounds: RhinoBounds.nullable(),
});
export type RhinoChange = z.infer<typeof RhinoChange>;

/** What a script did to the document, found by comparing every object before and after the run. */
export const RhinoRunChanges = z.strictObject({
  added: z.array(RhinoChange).max(500),
  changed: z.array(RhinoChange).max(500),
  deleted: z.array(RhinoChange).max(500),
  /** More objects changed than are listed. */
  truncated: z.boolean(),
});
export type RhinoRunChanges = z.infer<typeof RhinoRunChanges>;

/** The result of a Python run in Rhino. Output is capped by the plugin. */
export const RhinoPythonResult = z.strictObject({
  id: z.string().min(1).max(64),
  ok: z.boolean(),
  stdout: z.string().max(40_000),
  /** The value of a variable named `result`, as text, if the script set one. */
  result: z.string().max(40_000).optional(),
  /** The error message and the last lines of the traceback. */
  error: z.string().max(10_000).optional(),
  durationMs: z.number().nonnegative(),
  /** What the run added, changed and deleted; absent when the plugin could not compare the document. */
  changes: RhinoRunChanges.optional(),
});
export type RhinoPythonResult = z.infer<typeof RhinoPythonResult>;

/** The longest script the bridge sends Rhino to run. */
export const RHINO_PYTHON_MAX_CODE = 200_000;
