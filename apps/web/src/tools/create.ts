import type { Element, Point3Mm, PointMm, SceneDocument } from "@aex/protocol";
import { movedOffset } from "./placement.ts";
import type { Tool, ToolContext } from "./types.ts";

/** A new wall: thickness and height, millimetres; shorter drags than `minLength` place nothing. */
export const WALL = { thickness: 200, height: 3000, minLength: 300 };
/** A new slab: thickness, millimetres; both sides of the rectangle must reach `minSide`. */
export const SLAB = { thickness: 200, minSide: 300 };
/** A new column: section width and depth, and height, millimetres. */
export const COLUMN = { section: [400, 400] as [number, number], height: 3000 };

/** A new, unique element id for a type. */
const newId = (type: Element["type"]): string => `${type}-${crypto.randomUUID().slice(0, 8)}`;

/** The id and name a new element of a type gets, numbered after those of its type already in the model. */
function newIdentity(doc: SceneDocument, type: Element["type"], label: string): { id: string; name: string } {
  const count = Object.values(doc.elements).filter((e) => e.type === type).length;
  return { id: newId(type), name: `${label} ${count + 1}` };
}

/**
 * Where a new element's base goes for a point at height `z`: on the level whose elevation is that height (within 1 mm),
 * else at that height with no level. The ground, which is where points land unless a snap says otherwise, is a level
 * when the project has one at 0.
 */
export function levelFor(doc: SceneDocument, z: number): { level?: string; base?: number } {
  const level = doc.levels.find((l) => Math.abs(l.elevation - z) <= 1);
  if (level) return { level: level.id };
  return Math.abs(z) <= 1 ? {} : { base: Math.round(z) };
}

/**
 * The point under a viewer position, placed by the drawing aids that are on (the 100 mm grid unless the user switched it
 * off), in whole millimetres and at the height it snapped to; null if the view points away. `anchor` is where the line
 * began: its height is the plane the line is drawn in.
 */
function drawPoint(ctx: ToolContext, at: [number, number], anchor: Point3Mm | null = null): Point3Mm | null {
  const result = ctx.resolve(at, { anchor });
  if (!result) return null;
  const [x, y, z] = result.point;
  return [Math.round(x), Math.round(y), Math.round(z)];
}

/** What snapped the point under the pointer, for the notice: " (Endpoint)", " (Ortho)", or nothing. */
function snapNote(ctx: ToolContext): string {
  const snap = ctx.overlay().snap;
  if (!snap) return "";
  return ` (${snap.label}${snap.ortho && snap.label !== "Ortho" ? ", Ortho" : ""})`;
}

/** The same element moved by (dx, dy) in plan, whatever its type. */
export function shifted(element: Element, dx: number, dy: number): Element {
  const shift = ([x, y]: PointMm): PointMm => [x + dx, y + dy];
  switch (element.type) {
    case "massing":
      return { ...element, origin: [element.origin[0] + dx, element.origin[1] + dy, element.origin[2]] };
    case "column":
      return { ...element, position: shift(element.position) };
    case "wall":
      return { ...element, start: shift(element.start), end: shift(element.end) };
    case "slab":
      return { ...element, outline: element.outline.map(shift) };
    case "imported":
      return {
        ...element,
        translation: [element.translation[0] + dx, element.translation[1] + dy, element.translation[2]],
      };
  }
}

/** The wall a drag from `start` to `end` draws (not yet created). */
export function wallBetween(doc: SceneDocument, start: Point3Mm, end: Point3Mm): Element {
  return {
    ...newIdentity(doc, "wall", "Wall"),
    type: "wall",
    ...levelFor(doc, start[2]),
    properties: {},
    start: [start[0], start[1]],
    end: [end[0], end[1]],
    height: WALL.height,
    thickness: WALL.thickness,
  };
}

/** The slab a drag between two opposite corners draws: a rectangle, counter-clockwise. */
export function slabBetween(doc: SceneDocument, a: Point3Mm, b: Point3Mm): Element {
  const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
  const [y0, y1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
  return {
    ...newIdentity(doc, "slab", "Slab"),
    type: "slab",
    ...levelFor(doc, a[2]),
    properties: {},
    outline: [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ],
    thickness: SLAB.thickness,
  };
}

/**
 * A tool that draws an element by dragging on the ground: the draft shows while the hand moves, with its size in the
 * notice, and releasing creates it as one undo step.
 */
function dragToDraw(options: {
  id: string;
  label: string;
  feature: Tool["feature"];
  icon: string;
  shortcut: string;
  hint: string;
  draw(doc: SceneDocument, start: Point3Mm, end: Point3Mm): Element;
  /** The end of the drag may be held to an axis from its start (Ortho) or meet an edge at a right angle. */
  anchored?: boolean;
  /** Why the drag is too small to place anything, or null if it is big enough. */
  tooSmall(start: Point3Mm, end: Point3Mm): string | null;
  size(start: Point3Mm, end: Point3Mm): string;
}): Tool {
  let drag: { start: Point3Mm; end: Point3Mm } | null = null;
  const clear = (ctx: ToolContext) => ctx.setOverlay({ draft: null });
  return {
    id: options.id,
    label: options.label,
    feature: options.feature,
    icon: options.icon,
    shortcut: options.shortcut,
    activate(ctx) {
      ctx.setOverlay({ notice: options.hint });
    },
    deactivate(ctx) {
      drag = null;
      ctx.setOverlay({ notice: null, draft: null });
    },
    onTap(ctx) {
      ctx.setOverlay({ notice: options.hint });
    },
    onHover(ctx, at) {
      if (!drag) ctx.resolve(at);
    },
    onDragStart(ctx, at) {
      const start = drawPoint(ctx, at);
      if (!start || !ctx.doc()) return false;
      drag = { start, end: start };
      return true;
    },
    onDrag(ctx, at) {
      const doc = ctx.doc();
      const end = drawPoint(ctx, at, drag && options.anchored ? drag.start : null);
      if (!drag || !doc || !end) return;
      drag.end = end;
      const small = options.tooSmall(drag.start, end);
      ctx.setOverlay({
        draft: small ? null : options.draw(doc, drag.start, end),
        notice: small
          ? options.hint
          : `${options.size(drag.start, end)}${snapNote(ctx)}. Let go to place it.`,
      });
    },
    onDragEnd(ctx) {
      const doc = ctx.doc();
      const current = drag;
      drag = null;
      clear(ctx);
      if (!current || !doc) return;
      const small = options.tooSmall(current.start, current.end);
      if (small) {
        ctx.setOverlay({ notice: small });
        return;
      }
      const element = options.draw(doc, current.start, current.end);
      ctx.apply(`Add ${element.name}`, [{ op: "create", element }]);
      ctx.setOverlay({ notice: options.hint });
    },
    onDragCancel(ctx) {
      drag = null;
      clear(ctx);
    },
  };
}

const lengthMm = (a: Point3Mm, b: Point3Mm) => Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]));
/** The direction from a to b, degrees anticlockwise from the X axis, 0 to 360, to a tenth. */
const angleDeg = (a: Point3Mm, b: Point3Mm) => {
  const degrees = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  return Math.round(((degrees + 360) % 360) * 10) / 10;
};

/** Wall: pinch on the ground and drag from one end to the other; 200 mm thick, 3000 mm high. */
export function wallTool(): Tool {
  return dragToDraw({
    id: "wall",
    label: "Wall",
    feature: "createTools",
    icon: "M3 20h18M5 20V8h14v12M5 12h14M5 16h14M9 8v4M15 8v4M12 12v4M9 16v4M15 16v4",
    shortcut: "w",
    hint: "Pinch on the ground and drag from one end of the wall to the other.",
    draw: wallBetween,
    anchored: true,
    tooSmall: (a, b) =>
      lengthMm(a, b) < WALL.minLength ? `Drag farther: a wall is at least ${WALL.minLength} mm long.` : null,
    size: (a, b) => `Wall ${lengthMm(a, b)} mm at ${angleDeg(a, b)} deg`,
  });
}

/** Slab: pinch on the ground and drag from one corner to the opposite one; 200 mm thick. */
export function slabTool(): Tool {
  return dragToDraw({
    id: "slab",
    label: "Slab",
    feature: "createTools",
    icon: "M3 14l9-5 9 5-9 5zM3 14v2l9 5 9-5v-2",
    shortcut: "f",
    hint: "Pinch on the ground and drag from one corner of the slab to the opposite one.",
    draw: slabBetween,
    tooSmall: (a, b) =>
      Math.abs(b[0] - a[0]) < SLAB.minSide || Math.abs(b[1] - a[1]) < SLAB.minSide
        ? `Drag farther: each side of a slab is at least ${SLAB.minSide} mm.`
        : null,
    size: (a, b) => `Slab ${Math.abs(b[0] - a[0])} x ${Math.abs(b[1] - a[1])} mm`,
  });
}

/** Column: a tap on the ground places a 400 x 400 mm column, 3000 mm high, snapped to 100 mm. */
export const columnTool: Tool = {
  id: "column",
  label: "Column",
  feature: "createTools",
  icon: "M6 3h12v3H6zM6 18h12v3H6zM9 6v12M15 6v12",
  shortcut: "c",
  activate(ctx) {
    ctx.setOverlay({ notice: "Tap the ground to place a column." });
  },
  deactivate(ctx) {
    ctx.setOverlay({ notice: null });
  },
  onHover(ctx, at) {
    ctx.resolve(at);
  },
  onTap(ctx, at) {
    const doc = ctx.doc();
    const p = drawPoint(ctx, at);
    if (!doc || !p) return;
    const element: Element = {
      ...newIdentity(doc, "column", "Column"),
      type: "column",
      ...levelFor(doc, p[2]),
      properties: {},
      position: [p[0], p[1]],
      section: COLUMN.section,
      height: COLUMN.height,
    };
    ctx.apply(`Add ${element.name}`, [{ op: "create", element }]);
  },
};

/** Copy: pinch an element and drag the copy into place; it snaps to 100 mm or to the drawing aids and the original stays. */
export function copyTool(): Tool {
  let drag: { element: Element; heightMm: number; start: [number, number, number]; offset: PointMm } | null =
    null;
  const hint = "Pinch an element and drag its copy into place. It snaps to 100 mm.";
  return {
    id: "copy",
    label: "Copy",
    feature: "createTools",
    icon: "M8 8h11v11H8zM5 16V5h11",
    shortcut: "p",
    activate(ctx) {
      ctx.setOverlay({ notice: hint });
    },
    deactivate(ctx) {
      drag = null;
      ctx.setOverlay({ notice: null, draft: null });
    },
    onTap(ctx) {
      ctx.setOverlay({ notice: hint });
    },
    onDragStart(ctx, at, hit) {
      const element = hit ? ctx.doc()?.elements[hit.elementId] : undefined;
      if (!hit || !element) return false; // empty space: the view orbits instead
      const start = ctx.ground(at, hit.point[2]);
      if (!start) return false;
      drag = { element, heightMm: hit.point[2], start, offset: [0, 0] };
      return true;
    },
    onDrag(ctx, at) {
      const doc = ctx.doc();
      const p = drag ? ctx.ground(at, drag.heightMm) : null;
      if (!drag || !doc || !p) return;
      drag.offset = movedOffset(ctx, drag.element, drag.start, p, at);
      const [dx, dy] = drag.offset;
      const moved = dx !== 0 || dy !== 0;
      ctx.setOverlay({
        draft: moved ? shifted(drag.element, dx, dy) : null,
        notice: moved ? `Copy ${dx}, ${dy} mm away. Let go to place it.` : hint,
      });
    },
    onDragEnd(ctx) {
      const doc = ctx.doc();
      const current = drag;
      drag = null;
      ctx.setOverlay({ draft: null, notice: hint });
      if (!current || !doc) return;
      const [dx, dy] = current.offset;
      if (dx === 0 && dy === 0) return;
      const element = {
        ...shifted(current.element, dx, dy),
        id: newId(current.element.type),
        name: `${current.element.name} copy`,
      };
      ctx.apply(`Copy ${current.element.name}`, [{ op: "create", element }]);
    },
    onDragCancel(ctx) {
      drag = null;
      ctx.setOverlay({ draft: null });
    },
  };
}

/** The create ring at first start, clockwise from the top: the left hand's long pinch opens it. */
export const DEFAULT_CREATE_LAYOUT: Array<string | null> = [
  "wall",
  "slab",
  "column",
  "massing",
  "copy",
  "redo",
  "undo",
  "delete",
];
