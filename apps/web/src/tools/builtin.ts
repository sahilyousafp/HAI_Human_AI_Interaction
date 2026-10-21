import type { Element, Point3Mm, SceneOp } from "@aex/protocol";
import { columnTool, copyTool, slabTool, wallTool } from "./create.ts";
import { snap } from "./grid.ts";
import type { ToolRegistry } from "./registry.ts";
import type { Tool, ToolContext } from "./types.ts";

export { SNAP_MM, snap } from "./grid.ts";
/** Size of a new massing block: width, depth, height, millimetres. */
export const MASSING_SIZE: [number, number, number] = [6000, 6000, 3500];
/** Section: a full camera-frame height of hand movement sweeps this many times the model's height. */
const SECTION_GAIN = 1.5;
/** The section height moves in steps of this, millimetres. */
const SECTION_STEP_MM = 10;
/** The section plane reaches this far beyond the model on every side, millimetres (drawn and grabbable). */
export const SECTION_PAD_MM = 1000;

/** Whether the view ray at `at` meets the section plane inside its drawn outline. */
export function overSectionPlane(
  ctx: Pick<ToolContext, "overlay" | "ground" | "bounds">,
  at: [number, number],
): boolean {
  const height = ctx.overlay().sectionMm;
  const p = height === null ? null : ctx.ground(at, height);
  if (!p) return false;
  const { min, max } = ctx.bounds();
  const pad = SECTION_PAD_MM;
  return p[0] >= min[0] - pad && p[0] <= max[0] + pad && p[1] >= min[1] - pad && p[1] <= max[1] + pad;
}

const distanceMm = (a: Point3Mm, b: Point3Mm) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The operation that moves an element by (dx, dy) on the ground plane, whatever its type. */
export function moveOp(element: Element, dx: number, dy: number): SceneOp {
  const shift = ([x, y]: [number, number]): [number, number] => [x + dx, y + dy];
  switch (element.type) {
    case "massing":
      return {
        op: "update",
        id: element.id,
        patch: { origin: [element.origin[0] + dx, element.origin[1] + dy, element.origin[2]] },
      };
    case "column":
      return { op: "update", id: element.id, patch: { position: shift(element.position) } };
    case "wall":
      return {
        op: "update",
        id: element.id,
        patch: { start: shift(element.start), end: shift(element.end) },
      };
    case "slab":
      return { op: "update", id: element.id, patch: { outline: element.outline.map(shift) } };
  }
}

export const selectTool: Tool = {
  id: "select",
  label: "Select",
  icon: "M5 3l14 8-6 2-3 6z",
  shortcut: "v",
  onTap(ctx, _at, hit) {
    ctx.select(hit ? [hit.elementId] : []);
  },
};

/** Move: drag an element on the ground plane, snapped to 100 mm, one "Move" transaction on release. */
export function moveTool(): Tool {
  let drag: { element: Element; heightMm: number; start: Point3Mm; offset: [number, number] } | null = null;
  return {
    id: "move",
    label: "Move",
    icon: "M12 3v18M3 12h18M12 3 9 6M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3",
    shortcut: "m",
    activate(ctx) {
      ctx.setOverlay({ notice: "Pinch an element and drag it. It snaps to 100 mm." });
    },
    deactivate(ctx) {
      ctx.setOverlay({ notice: null });
    },
    onDragStart(ctx, at, hit) {
      const element = hit ? ctx.doc()?.elements[hit.elementId] : undefined;
      if (!hit || !element) return false; // empty space: the view orbits instead
      const start = ctx.ground(at, hit.point[2]);
      if (!start) return false;
      drag = { element, heightMm: hit.point[2], start, offset: [0, 0] };
      ctx.setOverlay({ movePreview: { id: element.id, offsetMm: [0, 0], from: JSON.stringify(element) } });
      return true;
    },
    onDrag(ctx, at) {
      if (!drag) return;
      const p = ctx.ground(at, drag.heightMm);
      if (!p) return;
      drag.offset = [snap(p[0] - drag.start[0]), snap(p[1] - drag.start[1])];
      ctx.setOverlay({
        movePreview: { id: drag.element.id, offsetMm: drag.offset, from: JSON.stringify(drag.element) },
      });
    },
    onDragEnd(ctx) {
      if (!drag) return;
      const [dx, dy] = drag.offset;
      // The preview stays until the moved element arrives from the bridge (it only applies while the element is
      // unchanged), so the block never jumps back for a frame.
      if (dx !== 0 || dy !== 0) ctx.apply("Move", [moveOp(drag.element, dx, dy)]);
      else ctx.setOverlay({ movePreview: null });
      drag = null;
    },
    onDragCancel(ctx) {
      drag = null;
      ctx.setOverlay({ movePreview: null });
    },
  };
}

/** Measure: two taps on the model show the distance between them in millimetres. */
export const measureTool: Tool = {
  id: "measure",
  label: "Measure",
  icon: "M3 17 17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2",
  shortcut: "d",
  activate(ctx) {
    ctx.setOverlay({ notice: "Tap the first point.", measure: [] });
  },
  deactivate(ctx) {
    ctx.setOverlay({ notice: null, measure: [] });
  },
  onTap(ctx, _at, hit) {
    if (!hit) {
      ctx.setOverlay({ notice: "Tap on the model to measure." });
      return;
    }
    const points = ctx.overlay().measure;
    if (points.length === 1 && points[0]) {
      ctx.setOverlay({
        measure: [points[0], hit.point],
        notice: `${Math.round(distanceMm(points[0], hit.point))} mm. Tap again to start a new measurement.`,
      });
    } else {
      ctx.setOverlay({ measure: [hit.point], notice: "Tap the second point." });
    }
  },
};

/** Section: a vertical drag moves a horizontal cut through the model; it stays until cleared. */
export function sectionTool(): Tool {
  let drag: { startY: number; startMm: number } | null = null;
  const range = (ctx: ToolContext) => {
    const { min, max } = ctx.bounds();
    return { min: min[2], max: max[2] };
  };
  return {
    id: "section",
    label: "Section",
    icon: "M4 8l8-4 8 4-8 4zM4 8v8l8 4 8-4V8M2 13h20",
    shortcut: "s",
    activate(ctx) {
      if (ctx.overlay().sectionMm === null) ctx.setOverlay({ sectionMm: range(ctx).max });
      ctx.setOverlay({ notice: "Pinch the section plane and drag down to cut lower, up to cut higher." });
    },
    deactivate(ctx) {
      ctx.setOverlay({ notice: null, sectionHover: false }); // the section itself stays until cleared
    },
    onHover(ctx, at) {
      const over = overSectionPlane(ctx, at) || ctx.onSectionLine(at);
      if (over !== ctx.overlay().sectionHover) ctx.setOverlay({ sectionHover: over });
    },
    onDragStart(ctx, at) {
      // Off the plane and its outline the view orbits, and a long pinch opens the palette.
      if (!overSectionPlane(ctx, at) && !ctx.onSectionLine(at)) return false;
      drag = { startY: at[1], startMm: ctx.overlay().sectionMm ?? range(ctx).max };
      ctx.setOverlay({ sectionHover: true });
      return true;
    },
    onDrag(ctx, at) {
      if (!drag) return;
      const { min, max } = range(ctx);
      const height = drag.startMm - (at[1] - drag.startY) * (max - min) * SECTION_GAIN;
      ctx.setOverlay({ sectionMm: Math.min(max, Math.max(min, snap(height, SECTION_STEP_MM))) });
    },
    onDragEnd() {
      drag = null;
    },
    onDragCancel() {
      drag = null;
    },
  };
}

/** Add massing: a tap on the ground places a 6000 x 6000 x 3500 mm block, centred and snapped to 100 mm. */
export const massingTool: Tool = {
  id: "massing",
  label: "Add massing",
  icon: "M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12 4 7.5",
  shortcut: "b",
  activate(ctx) {
    ctx.setOverlay({ notice: "Tap the ground to place a block." });
  },
  deactivate(ctx) {
    ctx.setOverlay({ notice: null });
  },
  onTap(ctx, at) {
    const doc = ctx.doc();
    const p = ctx.ground(at, 0);
    if (!doc || !p) return;
    const [w, d, h] = MASSING_SIZE;
    const [cx, cy] = [snap(p[0]), snap(p[1])];
    const count = Object.values(doc.elements).filter((e) => e.type === "massing").length;
    const ground = doc.levels.find((l) => l.elevation === 0);
    ctx.apply("Add massing", [
      {
        op: "create",
        element: {
          id: `massing-${crypto.randomUUID().slice(0, 8)}`,
          name: `Massing ${count + 1}`,
          type: "massing",
          ...(ground ? { level: ground.id } : {}),
          properties: {},
          origin: [cx - w / 2, cy - d / 2, 0],
          size: [w, d, h],
        },
      },
    ]);
  },
};

/** Delete: a tap marks an element; a nod or Enter deletes it, a shake or Escape keeps it. */
export const deleteTool: Tool = {
  id: "delete",
  label: "Delete",
  icon: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  shortcut: "x",
  activate(ctx) {
    ctx.setOverlay({ notice: "Tap an element to delete." });
  },
  deactivate(ctx) {
    ctx.setOverlay({ notice: null, marked: null });
  },
  onTap(ctx, at, hit) {
    const element = hit ? ctx.doc()?.elements[hit.elementId] : undefined;
    if (!element) {
      // The section plane is not part of the model; tapping it with Delete simply removes it.
      if (overSectionPlane(ctx, at) || ctx.onSectionLine(at)) {
        ctx.setOverlay({ sectionMm: null, sectionHover: false });
        ctx.flash("Section removed.");
      }
      return;
    }
    ctx.setOverlay({ marked: element.id, notice: null });
    ctx.confirm(
      `Delete ${element.name}? Nod or press Enter to delete. Shake or press Escape to keep it.`,
      (yes) => {
        ctx.setOverlay({ marked: null });
        if (yes) ctx.apply("Delete", [{ op: "delete", id: element.id }]);
        else ctx.flash(`Kept ${element.name}.`);
      },
    );
  },
};

export const undoTool: Tool = {
  id: "undo",
  label: "Undo",
  icon: "M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3",
  shortcut: "u",
  instant: true,
  run(ctx) {
    ctx.undo();
  },
};

export const redoTool: Tool = {
  id: "redo",
  label: "Redo",
  icon: "M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3",
  shortcut: "r",
  instant: true,
  run(ctx) {
    ctx.redo();
  },
};

export const askAgentTool: Tool = {
  id: "ask-agent",
  label: "Ask agent",
  icon: "M4 5h16v11H9l-5 4z",
  shortcut: "a",
  instant: true,
  run(ctx) {
    const problem = ctx.askAgent();
    if (problem) ctx.flash(problem);
  },
};

/**
 * The tools ring at first start, clockwise from the top: the right hand's long pinch opens it. Redo is in the create
 * ring, by key and in settings.
 */
export const DEFAULT_LAYOUT: Array<string | null> = [
  "select",
  "ask-agent",
  "measure",
  "section",
  "move",
  "massing",
  "delete",
  "undo",
];

export function registerBuiltinTools(registry: ToolRegistry): void {
  for (const tool of [
    selectTool,
    moveTool(),
    measureTool,
    sectionTool(),
    massingTool,
    deleteTool,
    undoTool,
    redoTool,
    askAgentTool,
    wallTool(),
    slabTool(),
    columnTool,
    copyTool(),
  ]) {
    registry.register(tool);
  }
}
