import { z } from "zod";
import { ElementId, Point3Mm } from "./scene.ts";

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
    /** Elements (or mirrored host objects) to frame. */
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
