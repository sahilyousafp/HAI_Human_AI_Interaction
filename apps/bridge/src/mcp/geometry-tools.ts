import { randomUUID } from "node:crypto";
import { type Element, RESERVED_TAG_PREFIX, type SceneDocument, type SceneOp } from "@hai/protocol";
import {
  arrayAlong,
  encodeMeshAsset,
  exportExtrusions,
  type MeshPart,
  partBounds,
  stopsAlong,
} from "@hai/scene";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { GeometryKernel, Recipe, RecipeAnswer, RecipeCurve, RecipeSolid } from "../geometry/kernel.ts";
import { failure, text } from "./tool-results.ts";
import { freshId, stopSignal } from "./tool-util.ts";

/** What the geometry tools need of the app besides the scene. */
export interface GeometryTools {
  kernel: Pick<GeometryKernel, "run">;
  /** Keeps a mesh asset in the project; false and why when it cannot. */
  storeAsset(id: string, bytes: Uint8Array): Promise<{ ok: true } | { ok: false; error: string }>;
  removeAsset(id: string): void;
}

export interface GeometryToolDeps {
  doc(): SceneDocument;
  apply(ops: SceneOp[], agent: string | null): { ok: true } | { ok: false; error: string };
  geometry: GeometryTools;
  requestSignal?: AbortSignal | undefined;
}

const Point3 = z.tuple([z.number(), z.number(), z.number()]);

const CurveRef = z
  .union([
    z.string().describe("the id of a line element"),
    z.strictObject({
      points: z.array(Point3).min(2).max(2000),
      closed: z.boolean().optional(),
    }),
  ])
  .describe(
    'A curve: the id of a line element, or { points: [[x, y, z], ...], closed? } in millimetres (for a sketch from "[sketches]", give its points).',
  );

const Taper = z
  .strictObject({ from: z.number().positive(), to: z.number().positive() })
  .describe("starts at `from` at the first copy and changes in a straight line to `to` at the last");

const KERNEL_NOTE =
  "This uses the OpenCascade geometry kernel (Python, installed on first use after the user agrees). The result is an imported model: a mesh the user sees and can move, turn, scale and delete, but not edit. All of it is one undoable step.";

type Curve = z.infer<typeof CurveRef>;
type ImportedElement = Extract<Element, { type: "imported" }>;

/** A curve reference as the recipes take it, or why it cannot be. */
function resolveCurve(doc: SceneDocument, ref: Curve, what: string): RecipeCurve | string {
  if (typeof ref !== "string") return { points: ref.points, closed: ref.closed ?? false };
  const element = doc.elements[ref];
  if (!element) return `No element "${ref}" for the ${what}.`;
  if (element.type !== "line")
    return `"${ref}" is a ${element.type}, not a line. A ${what} is a line element, or give its points.`;
  return { points: element.points, closed: element.closed };
}

function resolveAll(doc: SceneDocument, refs: Curve[], what: string): RecipeCurve[] | string {
  const curves: RecipeCurve[] = [];
  for (const ref of refs) {
    const curve = resolveCurve(doc, ref, what);
    if (typeof curve === "string") return curve;
    curves.push(curve);
  }
  return curves;
}

/** Elements as solids for a boolean: the extrusion of each footprint. */
function resolveSolids(doc: SceneDocument, ids: string[]): RecipeSolid[] | string {
  const extrusions = new Map(exportExtrusions(doc).map((e) => [e.id, e]));
  const solids: RecipeSolid[] = [];
  for (const id of ids) {
    const extrusion = extrusions.get(id);
    if (extrusion) {
      solids.push({
        outline: extrusion.footprint,
        z0: extrusion.baseMm,
        z1: extrusion.baseMm + extrusion.heightMm,
      });
      continue;
    }
    const element = doc.elements[id];
    if (!element) return `No element "${id}".`;
    return element.type === "imported" || element.type === "line"
      ? `"${id}" is ${element.type === "imported" ? "an imported mesh" : "a line"}, not a solid. Only massings, columns, walls and slabs can be combined.`
      : `"${id}" (${element.type}) has no footprint to make a solid from.`;
  }
  return solids;
}

/** The imported model that holds a kernel mesh: the mesh stored as an asset, and the element that refers to it. */
async function importedFrom(
  deps: GeometryToolDeps,
  answer: RecipeAnswer,
  name: string,
  taken: Set<string>,
): Promise<{ ok: true; element: ImportedElement } | { ok: false; error: string }> {
  const part = answer.parts?.[0];
  if (!part) return { ok: false, error: "The geometry kernel made no mesh." };
  const mesh: MeshPart = {
    positions: Float32Array.from(part.positions),
    indices: Uint32Array.from(part.indices),
  };
  const asset = randomUUID();
  const stored = await deps.geometry.storeAsset(asset, encodeMeshAsset([mesh]));
  if (!stored.ok) return stored;
  const id = freshId("imported", taken);
  taken.add(id);
  return {
    ok: true,
    element: {
      id,
      name,
      type: "imported",
      asset,
      part: 0,
      bounds: partBounds(mesh),
      translation: [0, 0, 0],
      properties: {},
    },
  };
}

/** The ids of the elements a batch of ops creates. */
const createdIds = (ops: SceneOp[]): string[] =>
  ops.flatMap((op) => (op.op === "create" ? [op.element.id] : []));

/** The elements a recipe was given by id, to be removed along with the result when asked. */
const deletes = (ids: string[]): SceneOp[] => ids.map((id) => ({ op: "delete", id }));

const idsOf = (refs: Curve[]): string[] => refs.filter((r): r is string => typeof r === "string");

/**
 * Tools that make geometry the scene's own elements cannot: copies along a curve, and (through OpenCascade) lofts,
 * sweeps, booleans and offsets. Each makes its result in one scene change, so one undo takes it back.
 */
export function registerGeometryTools(
  register: McpServer["registerTool"],
  deps: GeometryToolDeps,
  caller: { agent: string | null },
): void {
  register(
    "geometry_array_along_curve",
    {
      description: `Copies an element along a curve (a line element or points): one copy every \`spacing\` millimetres, or \`count\` copies spread evenly, between \`from\` and \`to\` measured along the curve. Each copy is centred on its place on the curve (its height follows the curve's rise) and, with align (the default), turned to run the way the curve does there; the element's own x axis is its length along the curve. The original stays where it is, as the module. A copy can change along the array: \`width\` sets a massing's or column's width across the curve (its y size) and \`scale\` scales the whole element, each from a value at the first copy to a value at the last in a straight line - "every 30 cm, the width starting at 15 cm and tapering to 5 cm" is spacing 300 with width { from: 150, to: 50 }. Copies are ordinary elements of the same type. Works for every element type except that width needs a massing or a column. At most 500 copies. Needs no kernel.`,
      inputSchema: z.object({
        element: z.string().describe("The id of the element to copy"),
        rail: CurveRef,
        spacing: z.number().positive().optional().describe("Millimetres between copies, along the curve"),
        count: z.number().int().min(1).max(500).optional().describe("Or this many copies, spread evenly"),
        from: z
          .number()
          .min(0)
          .optional()
          .describe("Where the first copy goes, mm along the curve (default 0)"),
        to: z.number().positive().optional().describe("Where the last may go (default the end of the curve)"),
        align: z.boolean().optional().describe("Turn each copy to run along the curve (default true)"),
        width: Taper.optional(),
        scale: Taper.optional(),
      }),
    },
    async ({ element: id, rail, spacing, count, from, to, align, width, scale }) => {
      const doc = deps.doc();
      const source = doc.elements[id];
      if (!source) return failure(`No element "${id}".`);
      const curve = resolveCurve(doc, rail, "rail");
      if (typeof curve === "string") return failure(curve);
      const stops = stopsAlong(curve.points, {
        closed: curve.closed,
        ...(spacing !== undefined ? { spacing } : {}),
        ...(count !== undefined ? { count } : {}),
        ...(from !== undefined ? { from } : {}),
        ...(to !== undefined ? { to } : {}),
      });
      if (!stops.ok) return failure(`Nothing was made: ${stops.error}`);
      const made = arrayAlong(
        source,
        stops.stops,
        { align: align ?? true, ...(width ? { width } : {}), ...(scale ? { scale } : {}) },
        doc.levels,
      );
      if (!made.ok) return failure(`Nothing was made: ${made.error}`);
      const taken = new Set(Object.keys(doc.elements));
      // The copies are the agent's own: the system's tags (owner, part, source) are not carried over.
      const tags = Object.fromEntries(
        Object.entries(source.tags ?? {}).filter(([name]) => !name.startsWith(RESERVED_TAG_PREFIX)),
      );
      const ops = made.copies.map((fields): SceneOp => {
        const copyId = freshId(source.type, taken);
        taken.add(copyId);
        return { op: "create", element: { ...source, ...fields, id: copyId, tags } as Element };
      });
      const result = deps.apply(ops, caller.agent);
      if (!result.ok) return failure(result.error);
      return text({
        created: createdIds(ops),
        curveLengthMm: Math.round(stops.length),
      });
    },
  );

  const kernelTool = <S extends z.ZodRawShape>(
    name: string,
    description: string,
    shape: S,
    plan: (
      input: z.infer<z.ZodObject<S>>,
      doc: SceneDocument,
    ) => { recipe: Recipe; title: string; consumed: string[] } | string,
    finish: (
      answer: RecipeAnswer,
      input: z.infer<z.ZodObject<S>>,
      doc: SceneDocument,
      taken: Set<string>,
    ) => Promise<{ ops: SceneOp[]; summary: Record<string, unknown> } | string>,
  ) =>
    register(
      name,
      { description: `${description} ${KERNEL_NOTE}`, inputSchema: z.object(shape) },
      async (raw, ctx) => {
        const input = raw as z.infer<z.ZodObject<S>>;
        const doc = deps.doc();
        const planned = plan(input, doc);
        if (typeof planned === "string") return failure(`Nothing was made: ${planned}`);
        const outcome = await deps.geometry.kernel.run(planned.recipe, planned.title, {
          agent: caller.agent,
          signal: stopSignal(ctx.mcpReq.signal, deps.requestSignal),
        });
        if (!outcome.ok) return failure(`Nothing was made: ${outcome.error}`);
        const done = await finish(outcome.answer, input, doc, new Set(Object.keys(doc.elements)));
        if (typeof done === "string") return failure(`Nothing was made: ${done}`);
        const result = deps.apply([...done.ops, ...deletes(planned.consumed)], caller.agent);
        if (!result.ok) {
          for (const op of done.ops)
            if (op.op === "create" && op.element.type === "imported")
              deps.geometry.removeAsset(op.element.asset);
          return failure(result.error);
        }
        return text({
          ...done.summary,
          ...(planned.consumed.length > 0 ? { deleted: planned.consumed } : {}),
        });
      },
    );

  /** Makes the imported model for an answer and the summary the agent reads. */
  const meshResult = async (answer: RecipeAnswer, name: string, taken: Set<string>) => {
    const made = await importedFrom(deps, answer, name, taken);
    if (!made.ok) return made.error;
    return {
      ops: [{ op: "create", element: made.element } as SceneOp],
      summary: {
        created: [made.element.id],
        ...(answer.volume !== undefined ? { volumeMm3: answer.volume } : {}),
        valid: answer.valid ?? true,
        triangles: (answer.parts?.[0]?.indices.length ?? 0) / 3,
      },
    };
  };

  kernelTool(
    "geometry_loft",
    "Lofts a smooth (or, with ruled, straight-sided) surface through two or more sections, in the order given: closed sections make a solid, open ones a surface. Sections are lines (line elements or points) that can be anywhere in space and need not have the same number of points.",
    {
      sections: z.array(CurveRef).min(2).max(50),
      ruled: z.boolean().optional().describe("Straight between sections instead of smooth"),
      name: z.string().trim().min(1).max(80).optional(),
      deleteInputs: z
        .boolean()
        .optional()
        .describe("Delete the section lines that were given by id (default false)"),
    },
    (input, doc) => {
      const sections = resolveAll(doc, input.sections, "section");
      if (typeof sections === "string") return sections;
      return {
        recipe: { recipe: "loft", sections, ruled: input.ruled ?? false },
        title: "Loft",
        consumed: input.deleteInputs ? idsOf(input.sections) : [],
      };
    },
    (answer, input, _doc, taken) => meshResult(answer, input.name ?? "Loft", taken),
  );

  kernelTool(
    "geometry_sweep",
    "Sweeps a profile along a rail: a closed profile makes a solid, an open one a surface. Draw the profile at the start of the rail, across it (the profile is swept from where it is). Set smooth to fit one smooth curve through the rail's points instead of straight segments with sharp corners.",
    {
      profile: CurveRef,
      rail: CurveRef,
      smooth: z.boolean().optional().describe("Fit a smooth curve through the rail's points"),
      name: z.string().trim().min(1).max(80).optional(),
      deleteInputs: z
        .boolean()
        .optional()
        .describe("Delete the profile and rail lines that were given by id (default false)"),
    },
    (input, doc) => {
      const profile = resolveCurve(doc, input.profile, "profile");
      if (typeof profile === "string") return profile;
      const rail = resolveCurve(doc, input.rail, "rail");
      if (typeof rail === "string") return rail;
      return {
        recipe: { recipe: "sweep", profile, rail, smooth: input.smooth ?? false },
        title: "Sweep",
        consumed: input.deleteInputs ? idsOf([input.profile, input.rail]) : [],
      };
    },
    (answer, input, _doc, taken) => meshResult(answer, input.name ?? "Sweep", taken),
  );

  kernelTool(
    "geometry_boolean",
    "Combines solids: union joins group a and group b into one, difference cuts b out of a, intersection keeps only where a and b overlap. a and b are lists of massing, column, wall or slab ids (each list is joined first). The solids that were given are deleted unless deleteInputs is false.",
    {
      operation: z.enum(["union", "difference", "intersection"]),
      a: z.array(z.string()).min(1).max(50),
      b: z.array(z.string()).min(1).max(50),
      name: z.string().trim().min(1).max(80).optional(),
      deleteInputs: z.boolean().optional().describe("Delete the solids that were combined (default true)"),
    },
    (input, doc) => {
      const a = resolveSolids(doc, input.a);
      if (typeof a === "string") return a;
      const b = resolveSolids(doc, input.b);
      if (typeof b === "string") return b;
      return {
        recipe: { recipe: "boolean", op: input.operation, a, b },
        title: `Boolean ${input.operation}`,
        consumed: input.deleteInputs === false ? [] : [...new Set([...input.a, ...input.b])],
      };
    },
    (answer, input, _doc, taken) =>
      meshResult(answer, input.name ?? input.operation[0]?.toUpperCase() + input.operation.slice(1), taken),
  );

  kernelTool(
    "geometry_offset",
    "Offsets a flat curve sideways by a distance in millimetres and makes the result as new line elements. A closed curve grows for a positive distance and shrinks for a negative one; an open curve moves to the right of the way it runs for a positive distance and to the left for a negative one. corners: sharp (default) keeps the corners, round rounds them. The curve must lie in one plane.",
    {
      curve: CurveRef,
      distance: z.number().refine((d) => d !== 0, "the distance must not be zero"),
      corners: z.enum(["sharp", "round"]).optional(),
      name: z.string().trim().min(1).max(80).optional(),
    },
    (input, doc) => {
      const curve = resolveCurve(doc, input.curve, "curve");
      if (typeof curve === "string") return curve;
      return {
        recipe: { recipe: "offset", curve, distance: input.distance, corners: input.corners ?? "sharp" },
        title: "Offset",
        consumed: [],
      };
    },
    async (answer, input, doc, taken) => {
      if (!answer.curves?.length) return "Nothing is left of the curve at that distance.";
      const level = typeof input.curve === "string" ? doc.elements[input.curve]?.level : undefined;
      const ops = answer.curves.map((curve): SceneOp => {
        const id = freshId("line", taken);
        taken.add(id);
        return {
          op: "create",
          element: {
            id,
            name: input.name ?? "Offset",
            type: "line",
            points: curve.points,
            closed: curve.closed,
            ...(level ? { level } : {}),
            properties: {},
          },
        };
      });
      return { ops, summary: { created: createdIds(ops) } };
    },
  );
}
