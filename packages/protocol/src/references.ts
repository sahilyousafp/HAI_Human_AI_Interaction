import { z } from "zod";
import { Point3Mm } from "./scene.ts";

/** Sketches kept at once: a ninth replaces the oldest. */
export const MAX_SKETCHES = 8;
/** Points in one sketch once simplified (a long freehand outline stays readable for the agent). */
export const MAX_SKETCH_POINTS = 200;

/**
 * A path or a closed outline the user drew for the agent (Sketch line, Sketch area): not a model element and not an
 * undo step. Points are millimetres, in order; an outline's last point joins its first.
 */
export const Sketch = z.strictObject({
  label: z.string().regex(/^S\d{1,3}$/),
  kind: z.enum(["path", "outline"]),
  points: z.array(Point3Mm).min(2).max(MAX_SKETCH_POINTS),
});
export type Sketch = z.infer<typeof Sketch>;

/** A lettered point the user placed for the agent (Place marker), kept with the project. */
export const LetterMarker = z.strictObject({ letter: z.string().regex(/^[A-Z]$/), point: Point3Mm });
export type LetterMarker = z.infer<typeof LetterMarker>;

/** The project's markers, at most one per letter. */
export const LetterMarkers = z
  .array(LetterMarker)
  .max(26)
  .refine(
    (markers) => new Set(markers.map((m) => m.letter)).size === markers.length,
    "A letter is used twice",
  );
