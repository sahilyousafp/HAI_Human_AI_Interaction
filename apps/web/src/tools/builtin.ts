import type { Element, Point3Mm, SceneOp } from "@hai/protocol";
import {
  applySteps,
  elementBounds,
  type LineElement,
  linePointAt,
  linePointMoved,
  linePointRemoved,
  transformOp,
  transformPatch,
  unionBounds,
} from "@hai/scene";
import { actedOn, confirmDelete, describeElements } from "./acted-on.ts";
import { columnTool, copyTool, lineTool, slabTool, wallTool } from "./create.ts";
import { snap } from "./grid.ts";
import { lassoTool } from "./lasso.ts";
import { movedOffset } from "./placement.ts";
import { placeMarkerTool, referenceAt, sketchAreaTool, sketchLineTool } from "./reference.ts";
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
  // A move in plan never needs the levels (they only matter to a change of height).
  return transformOp(element, { kind: "translate", by: [dx, dy, 0] }, []) as SceneOp;
}

/** Rotate: the smallest step a free turn takes, degrees (the angle step applies when Ortho is on). */
const ROTATE_STEP_DEG = 1;

export const selectTool: Tool = {
  id: "select",
  label: "Select",
  spoken: ["select"],
  icon: "M5 3l14 8-6 2-3 6z",
  shortcut: "v",
  onTap(ctx, _at, hit) {
    ctx.select(hit ? [hit.elementId] : []);
  },
};

/** How near a pointer must be to a line's point on screen to mean that point, px (the drawing aids' snap reach). */
export const LINE_POINT_REACH_PX = 24;

/** The line point under a viewer position, among the lines that are shown. */
function linePointUnder(ctx: ToolContext, at: [number, number]): { line: LineElement; index: number } | null {
  const doc = ctx.doc();
  if (!doc) return null;
  const hidden = ctx.hidden();
  const lines = Object.values(doc.elements).filter(
    (e): e is LineElement => e.type === "line" && !hidden.has(e.id),
  );
  const found = linePointAt(lines, ctx.toScreen, ctx.toPixels(at), LINE_POINT_REACH_PX);
  const line = found ? lines.find((l) => l.id === found.id) : undefined;
  return found && line ? { line, index: found.index } : null;
}

/** What a move preview remembers of each element it carries: it applies only while the element is still as it was. */
const previewOf = (elements: Element[]): Record<string, string> =>
  Object.fromEntries(elements.map((e) => [e.id, JSON.stringify(e)]));

/**
 * Move: drag an element on the ground plane, snapped to 100 mm or to the drawing aids, one "Move" transaction on
 * release. With several elements selected, a drag that starts on one of them carries all of them. A pinch on a line's
 * point moves that point alone, through the drawing aids, as one "Move point" transaction.
 */
export function moveTool(): Tool {
  let pointDrag: { line: LineElement; index: number; from: Point3Mm; to: Point3Mm } | null = null;
  let drag: {
    element: Element;
    carried: Element[];
    heightMm: number;
    start: Point3Mm;
    offset: [number, number];
  } | null = null;
  return {
    id: "move",
    label: "Move",
    spoken: ["move"],
    icon: "M12 3v18M3 12h18M12 3 9 6M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3",
    shortcut: "m",
    editsLinePoints: true,
    activate(ctx) {
      ctx.setOverlay({ notice: "Pinch an element and drag it, or a line's point. It snaps to 100 mm." });
    },
    deactivate(ctx) {
      pointDrag = null;
      ctx.setOverlay({ notice: null, draft: null, draftOf: null });
    },
    onDragStart(ctx, at, hit) {
      const point = linePointUnder(ctx, at);
      const from = point?.line.points[point.index];
      if (point && from) {
        pointDrag = { ...point, from, to: from };
        ctx.setOverlay({ draft: null, draftOf: null });
        return true;
      }
      const element = hit ? ctx.doc()?.elements[hit.elementId] : undefined;
      if (!hit || !element) return false; // empty space: the view orbits instead
      const start = ctx.ground(at, hit.point[2]);
      if (!start) return false;
      const carried = actedOn(ctx, element);
      drag = { element, carried, heightMm: hit.point[2], start, offset: [0, 0] };
      ctx.setOverlay({ movePreview: { offsetMm: [0, 0], from: previewOf(carried) } });
      return true;
    },
    onDrag(ctx, at) {
      if (pointDrag) {
        const { line, index, from } = pointDrag;
        const resolved = ctx.resolve(at, { anchor: from, exclude: [line.id] });
        if (!resolved) return;
        const [x, y, z] = resolved.point;
        const to: Point3Mm = [Math.round(x), Math.round(y), Math.round(z)];
        pointDrag.to = to;
        ctx.setOverlay({
          draft: { ...line, ...linePointMoved(line, index, to) },
          draftOf: JSON.stringify(line),
        });
        return;
      }
      if (!drag) return;
      const p = ctx.ground(at, drag.heightMm);
      if (!p) return;
      drag.offset = movedOffset(ctx, drag.element, drag.start, p, at);
      ctx.setOverlay({ movePreview: { offsetMm: drag.offset, from: previewOf(drag.carried) } });
    },
    onDragEnd(ctx) {
      if (pointDrag) {
        const { line, index, from, to } = pointDrag;
        pointDrag = null;
        // As with a moved element, the draft stays until the change arrives (`draftOf` then no longer matches).
        if (to[0] !== from[0] || to[1] !== from[1] || to[2] !== from[2])
          ctx.apply("Move point", [{ op: "update", id: line.id, patch: linePointMoved(line, index, to) }]);
        else ctx.setOverlay({ draft: null, draftOf: null });
        return;
      }
      if (!drag) return;
      const [dx, dy] = drag.offset;
      // The preview stays until the moved elements arrive from the bridge (it only applies while an element is
      // unchanged), so the block never jumps back for a frame. All of them are one undo step.
      if (dx !== 0 || dy !== 0)
        ctx.apply(
          "Move",
          drag.carried.map((element) => moveOp(element, dx, dy)),
        );
      else ctx.setOverlay({ movePreview: null });
      drag = null;
    },
    onDragCancel(ctx) {
      drag = null;
      pointDrag = null;
      ctx.setOverlay({ movePreview: null, draft: null, draftOf: null });
    },
  };
}

/**
 * Rotate: a drag turns what is selected, or the element or group it starts on, about the centre of its plan box, as one
 * body and one undo step, in the angle step when Ortho is on. With nothing there and nothing selected the view orbits.
 */
export function rotateTool(): Tool {
  let drag: {
    carried: Element[];
    about: Point3Mm;
    startDeg: number;
    deg: number;
    from: Record<string, string>;
  } | null = null;
  const hint = "Pinch and drag around the centre to turn. Tap to choose what to turn.";
  const angleAt = (ctx: ToolContext, at: [number, number], about: Point3Mm): number | null => {
    const p = ctx.ground(at, about[2]);
    return p ? (Math.atan2(p[1] - about[1], p[0] - about[0]) * 180) / Math.PI : null;
  };
  const clear = (ctx: ToolContext) => ctx.setOverlay({ drafts: [], draftsOf: {}, pivot: null });
  return {
    id: "rotate",
    label: "Rotate",
    spoken: ["rotate", "turn"],
    icon: "M20 11a8 8 0 1 0-2.3 6.3M20 5v6h-6",
    shortcut: "o",
    activate(ctx) {
      ctx.setOverlay({ notice: hint });
    },
    deactivate(ctx) {
      drag = null;
      clear(ctx);
      ctx.setOverlay({ notice: null });
    },
    onTap(ctx, _at, hit) {
      const element = hit ? ctx.doc()?.elements[hit.elementId] : undefined;
      ctx.select(element ? actedOn(ctx, element).map((e) => e.id) : []);
    },
    onDragStart(ctx, at, hit) {
      const doc = ctx.doc();
      if (!doc) return false;
      const grabbed = hit ? doc.elements[hit.elementId] : undefined;
      const hidden = ctx.hidden();
      const carried = grabbed
        ? actedOn(ctx, grabbed)
        : ctx.selection().flatMap((id) => {
            const element = doc.elements[id];
            return element && !hidden.has(id) ? [element] : [];
          });
      const box = unionBounds(carried.map((element) => elementBounds(element, doc.levels)));
      if (!box) return false; // nothing to turn: the view orbits instead
      const about: Point3Mm = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, box.min[2]];
      const startDeg = angleAt(ctx, at, about);
      if (startDeg === null) {
        ctx.flash("Nothing to turn on there. Use the Top or the perspective view.");
        return false;
      }
      clear(ctx);
      drag = {
        carried,
        about,
        startDeg,
        deg: 0,
        from: Object.fromEntries(carried.map((element) => [element.id, JSON.stringify(element)])),
      };
      ctx.setOverlay({ pivot: { point: about, label: "0°" } });
      return true;
    },
    onDrag(ctx, at) {
      const doc = ctx.doc();
      const raw = drag ? angleAt(ctx, at, drag.about) : null;
      if (!drag || !doc || raw === null) return;
      const step = ctx.aids().ortho ? ctx.constraints().angleStepDeg : ROTATE_STEP_DEG;
      const turned = Math.round((((((raw - drag.startDeg + 180) % 360) + 360) % 360) - 180) / step) * step;
      drag.deg = turned;
      const about: [number, number] = [drag.about[0], drag.about[1]];
      const t = { kind: "rotate" as const, deg: turned, about };
      ctx.setOverlay({
        drafts: drag.carried.map(
          (element) => ({ ...element, ...transformPatch(element, t, doc.levels) }) as Element,
        ),
        draftsOf: drag.from,
        pivot: { point: drag.about, label: `${turned}°` },
        notice: `Rotate ${turned} deg. Let go to keep it.`,
      });
    },
    onDragEnd(ctx) {
      const doc = ctx.doc();
      const current = drag;
      drag = null;
      ctx.setOverlay({ pivot: null, notice: hint });
      if (!current || !doc || current.deg === 0) {
        clear(ctx);
        return;
      }
      const about: [number, number] = [current.about[0], current.about[1]];
      const done = applySteps(current.carried, [{ kind: "rotate", deg: current.deg, about }], doc.levels);
      if (!done.ok) {
        clear(ctx);
        ctx.flash(done.error);
        return;
      }
      // As with a moved element, the drafts stay until the change arrives (`draftsOf` then no longer matches).
      ctx.apply(
        `Rotate ${describeElements(doc, current.carried)}`,
        Object.entries(done.patches).map(([id, patch]): SceneOp => ({ op: "update", id, patch })),
      );
    },
    onDragCancel(ctx) {
      drag = null;
      clear(ctx);
    },
  };
}

/** Measure: two taps on the model show the distance between them in millimetres. */
export const measureTool: Tool = {
  id: "measure",
  label: "Measure",
  spoken: ["measure"],
  icon: "M3 17 17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2",
  shortcut: "d",
  activate(ctx) {
    ctx.setOverlay({ notice: "Tap the first point.", measure: [] });
  },
  deactivate(ctx) {
    ctx.setOverlay({ notice: null, measure: [] });
  },
  onHover(ctx, at) {
    ctx.resolve(at);
  },
  onTap(ctx, at, hit) {
    // A point of the model the drawing aids found (an end, a middle, a centre, an edge), at its real height; else the
    // surface point under the pointer.
    const found = ctx.resolve(at);
    const geometric = found && found.kind !== null && found.kind !== "grid" && found.kind !== "ortho";
    const point = geometric ? found.point : (hit?.point ?? null);
    if (!point) {
      ctx.setOverlay({ notice: "Tap on the model to measure." });
      return;
    }
    const points = ctx.overlay().measure;
    if (points.length === 1 && points[0]) {
      const [a, b] = [points[0], point];
      const across = Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]));
      const up = Math.round(Math.abs(b[2] - a[2]));
      ctx.setOverlay({
        measure: [a, b],
        notice: `${Math.round(distanceMm(a, b))} mm (${across} across, ${up} up). Tap again to start a new measurement.`,
      });
    } else {
      ctx.setOverlay({ measure: [point], notice: "Tap the second point." });
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
    spoken: ["section", "cut"],
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
  spoken: ["massing", "add massing", "block"],
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
  spoken: ["delete", "erase"],
  icon: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  shortcut: "x",
  editsLinePoints: true,
  activate(ctx) {
    ctx.setOverlay({ notice: "Tap an element to delete." });
  },
  deactivate(ctx) {
    ctx.setOverlay({ notice: null, marked: [] });
  },
  onTap(ctx, at, hit) {
    // Sketches and markers lie over the model, so a tap on one removes it, without asking: neither is model work.
    const reference = referenceAt(ctx, at);
    if (reference?.kind === "marker") {
      ctx.references.removeMarker(reference.letter);
      ctx.flash(`Marker ${reference.letter} removed.`);
      return;
    }
    if (reference?.kind === "sketch") {
      ctx.references.removeSketch(reference.label);
      ctx.flash(`${reference.label} removed.`);
      return;
    }
    const point = linePointUnder(ctx, at);
    if (point) {
      const patch = linePointRemoved(point.line, point.index);
      if (patch) {
        ctx.apply("Delete point", [{ op: "update", id: point.line.id, patch }]);
        ctx.flash("Point removed. Undo brings it back.");
        return;
      }
      // Two points are the least a line can have: taking one is taking the line, and that is asked for below.
    }
    const hitElement = hit ? ctx.doc()?.elements[hit.elementId] : undefined;
    const element = point?.line ?? hitElement;
    if (!element) {
      // The section plane is not part of the model; tapping it with Delete simply removes it.
      if (overSectionPlane(ctx, at) || ctx.onSectionLine(at)) {
        ctx.setOverlay({ sectionMm: null, sectionHover: false });
        ctx.flash("Section removed.");
      }
      return;
    }
    confirmDelete(ctx, actedOn(ctx, element));
  },
};

export const undoTool: Tool = {
  id: "undo",
  label: "Undo",
  // "undue" is how the on-device speech model hears a short "undo" (measured).
  spoken: ["undo", "undue"],
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
  spoken: ["redo"],
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
  spoken: ["ask", "ask agent"],
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
export function registerBuiltinTools(registry: ToolRegistry): void {
  for (const tool of [
    selectTool,
    moveTool(),
    rotateTool(),
    measureTool,
    sectionTool(),
    massingTool,
    deleteTool,
    undoTool,
    redoTool,
    askAgentTool,
    wallTool(),
    lineTool(),
    slabTool(),
    columnTool,
    copyTool(),
    sketchLineTool(),
    sketchAreaTool(),
    placeMarkerTool,
    lassoTool(),
  ]) {
    registry.register(tool);
  }
}
