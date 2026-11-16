import type { HostId, HostObject, Point3Mm } from "@hai/protocol";
import type { ToolContext } from "./types.ts";

/** A host's object that a tool acts on, and the host it belongs to. */
export interface HostTarget {
  host: HostId;
  object: HostObject;
}

/** Host objects a tool acts on: always one host's. */
export interface HostTargets {
  host: HostId;
  objects: HostObject[];
}

/**
 * What a tool acts on when it is used on the host object `id`: the host's whole selection when `id` is part of a
 * selection of several, else that object. Null when `id` is not a host's object. The host counterpart of `actedOn`.
 */
export function hostTargetsOf(ctx: ToolContext, id: string): HostTargets | null {
  const grabbed = ctx.hostTarget(id);
  if (!grabbed) return null;
  const selected = ctx.hostSelection();
  const ids = selected.length >= 2 && selected.includes(id) ? selected : [id];
  const objects = ids.flatMap((i) => {
    const target = ctx.hostTarget(i);
    return target && target.host === grabbed.host ? [target.object] : [];
  });
  return { host: grabbed.host, objects: objects.length > 0 ? objects : [grabbed.object] };
}

/** The host's selection as targets, or null when nothing is selected in a host. */
export function selectedHostTargets(ctx: ToolContext): HostTargets | null {
  const [first] = ctx.hostSelection();
  return first ? hostTargetsOf(ctx, first) : null;
}

/** The box around objects, millimetres. */
export function boxOfObjects(objects: HostObject[]): { min: Point3Mm; max: Point3Mm } {
  const min: Point3Mm = [Infinity, Infinity, Infinity];
  const max: Point3Mm = [-Infinity, -Infinity, -Infinity];
  for (const { bounds } of objects)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k] as number, bounds.min[k] as number);
      max[k] = Math.max(max[k] as number, bounds.max[k] as number);
    }
  return { min, max };
}

/** Host objects in a few words: "Canopy", "3 objects". */
export function describeObjects(objects: HostObject[]): string {
  const [first] = objects;
  return objects.length === 1 && first ? first.name || "the object" : `${objects.length} objects`;
}

/** A move by (dx, dy, dz) millimetres, as a 4 x 4 matrix row by row. */
export function translation(dx: number, dy: number, dz = 0): number[] {
  return [1, 0, 0, dx, 0, 1, 0, dy, 0, 0, 1, dz, 0, 0, 0, 1];
}

/** A turn of `deg` degrees counter-clockwise in plan about the vertical line through `about`, row by row. */
export function rotationAbout(deg: number, about: readonly [number, number]): number[] {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const [x, y] = about;
  // Move `about` to the origin, turn, move back: the shift is what is left of `about` after the turn.
  return [c, -s, 0, x - c * x + s * y, s, c, 0, y - s * x - c * y, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** A mirror across the vertical plane where coordinate `axis` (0 for x, 1 for y) equals `at`, row by row. */
export function mirrorAcross(axis: 0 | 1, at: number): number[] {
  return axis === 0
    ? [-1, 0, 0, 2 * at, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    : [1, 0, 0, 0, 0, -1, 0, 2 * at, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** `a` after `b`: the matrix that does `b`, then `a`. Both row by row. */
export function multiply(a: number[], b: number[]): number[] {
  const out: number[] = [];
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < 4; col++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += (a[row * 4 + k] as number) * (b[k * 4 + col] as number);
      out.push(sum);
    }
  return out;
}

/** Where a matrix takes a point. */
export function transformPoint(m: number[], [x, y, z]: Point3Mm): Point3Mm {
  const at = (row: number) =>
    (m[row * 4] as number) * x +
    (m[row * 4 + 1] as number) * y +
    (m[row * 4 + 2] as number) * z +
    (m[row * 4 + 3] as number);
  return [at(0), at(1), at(2)];
}

/** Marks a host's objects and asks once whether to delete them: a nod or Enter deletes them in the host. */
export function confirmHostDelete(ctx: ToolContext, targets: HostTargets): void {
  const what = describeObjects(targets.objects);
  const ids = targets.objects.map((o) => o.id);
  ctx.setOverlay({ marked: ids, notice: null });
  ctx.confirm(`Delete ${what}? Nod or press Enter to delete. Shake or press Escape to keep it.`, (yes) => {
    ctx.setOverlay({ marked: [] });
    if (yes) ctx.applyHost(targets.host, `Delete ${what}`, { op: "delete", ids });
    else ctx.flash(`Kept ${what}.`);
  });
}
