import { z } from "zod";

/**
 * The aids that help the create tools and Move place a point exactly (Settings > Drawing aids). Grid is on until
 * the user turns it off; the rest are off until the user turns them on.
 */
export const DRAWING_AIDS = [
  {
    id: "grid",
    label: "Grid",
    description: "Points land on a 100 mm grid.",
    default: true,
  },
  {
    id: "ortho",
    label: "Ortho",
    description: "Lines lock to the X axis, the Y axis or 45 degrees from where they start.",
    default: false,
  },
  {
    id: "endpoint",
    label: "Endpoint",
    description: "Points snap to the ends of walls, the corners of slabs and the centres of columns.",
    default: false,
  },
  {
    id: "midpoint",
    label: "Midpoint",
    description: "Points snap to the middle of a wall or an edge.",
    default: false,
  },
  {
    id: "centre",
    label: "Centre",
    description: "Points snap to the centre of a slab, a massing or an imported model.",
    default: false,
  },
  {
    id: "project",
    label: "Project",
    description: "Points are carried onto the nearest edge of the model.",
    default: false,
  },
  {
    id: "perpendicular",
    label: "Perpendicular",
    description: "A line meets an edge at a right angle.",
    default: false,
  },
] as const satisfies ReadonlyArray<{ id: string; label: string; description: string; default: boolean }>;

export type DrawingAidId = (typeof DRAWING_AIDS)[number]["id"];
export const DRAWING_AID_IDS = DRAWING_AIDS.map((a) => a.id) as DrawingAidId[];

/** Which aids are on. */
export type DrawingAids = Record<DrawingAidId, boolean>;

export const DEFAULT_DRAWING_AIDS = Object.fromEntries(
  DRAWING_AIDS.map((a) => [a.id, a.default]),
) as DrawingAids;

/** The user's choices: only the aids they changed. Unknown names (from a newer or older app) are ignored. */
export const DrawingAidChoices = z.record(z.string(), z.boolean());
export type DrawingAidChoices = z.infer<typeof DrawingAidChoices>;

/** Stored choices over the defaults. */
export function resolveDrawingAids(stored: DrawingAidChoices | null | undefined): DrawingAids {
  const aids = { ...DEFAULT_DRAWING_AIDS };
  for (const id of DRAWING_AID_IDS) {
    const on = stored?.[id];
    if (typeof on === "boolean") aids[id] = on;
  }
  return aids;
}
