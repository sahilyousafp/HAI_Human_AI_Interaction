import type { ContextBuilding, ContextItem, SceneOp } from "@hai/protocol";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { adoptOp } from "../open-data/context-store.ts";
import { failure, text } from "./tool-results.ts";

/** What the context tools need of the app: the layer, and a way to change the model like any other writer. */
export interface ContextTools {
  summary(): unknown;
  nearest(
    near: readonly [number, number],
    options: { kinds?: ReadonlyArray<ContextItem["kind"]>; radiusMm?: number; limit: number },
  ): { items: ContextItem[]; total: number; truncated: boolean };
  byId(id: string): ContextItem | undefined;
  /** The credit text of a source id, for the tag on an adopted item. */
  sourceName(sourceId: string): string;
  /** The model's element ids, to keep an adopted id unique. */
  taken(): ReadonlySet<string>;
  /** Empties the layer, tells every page, and returns how many items of each kind it held. */
  clear(): { building: number; tree: number; raster: number };
}

/** The most items one `context_get` returns. */
export const CONTEXT_GET_MAX = 200;
/** The most buildings one `context_adopt` takes into the model. */
export const CONTEXT_ADOPT_MAX = 50;

/** An item as an agent is told about it: positions in model millimetres, rasters without their picture. */
function describe(item: ContextItem) {
  switch (item.kind) {
    case "building":
      return {
        id: item.id,
        kind: item.kind,
        footprint: item.footprint,
        heightMm: item.heightMm,
        heightSource: item.heightSource,
        baseMm: item.baseMm,
        source: item.source,
        ...(item.label ? { label: item.label } : {}),
      };
    case "tree":
      return {
        id: item.id,
        kind: item.kind,
        position: item.position,
        ...(item.heightMm ? { heightMm: item.heightMm } : {}),
        source: item.source,
      };
    case "raster":
      return {
        id: item.id,
        kind: item.kind,
        label: item.label,
        quantity: item.quantity,
        unit: item.unit,
        date: item.date,
        minMm: item.minMm,
        maxMm: item.maxMm,
        range: item.range,
        source: item.source,
      };
  }
}

/**
 * Registers `context_list` and `context_get` (reading the layer), `context_adopt` (offered to writers only) and
 * `context_clear` (emptying it, for every agent).
 */
export function registerContextTools(
  register: McpServer["registerTool"],
  deps: ContextTools,
  apply: (ops: SceneOp[]) => { ok: true } | { ok: false; error: string },
): void {
  register(
    "context_list",
    {
      description:
        "What the city context layer holds: counts of buildings, trees and ground rasters, how many building heights were measured or worked out, the sources with their dates and credits, and whether the layer is out of date because the project's site changed. The layer is read-only context drawn beside the model (not part of it): fetched by Urban and Simulation, seen in everyone's pictures and in sun studies. Positions are in model millimetres.",
      inputSchema: z.object({}),
    },
    async () => text(deps.summary()),
  );

  register(
    "context_get",
    {
      description: `The items of the context layer near a point, nearest first (at most ${CONTEXT_GET_MAX}; it says when it left some out). Buildings have their footprint (plan, mm), height and where the height came from (measured, inferred from levels, or a default); trees their position; rasters their box, quantity, unit and date (not the picture). Positions are model millimetres.`,
      inputSchema: z.object({
        kind: z.enum(["building", "tree", "raster"]).optional().describe("Only this kind"),
        x_mm: z.number().optional().describe("Model x of the point to measure from (default 0, the origin)"),
        y_mm: z.number().optional().describe("Model y of the point to measure from (default 0)"),
        radius_m: z
          .number()
          .positive()
          .optional()
          .describe("Only items within this many metres of the point"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(CONTEXT_GET_MAX)
          .optional()
          .describe(`How many (default 50, at most ${CONTEXT_GET_MAX})`),
      }),
    },
    async (input) => {
      const found = deps.nearest([input.x_mm ?? 0, input.y_mm ?? 0], {
        ...(input.kind ? { kinds: [input.kind] } : {}),
        ...(input.radius_m !== undefined ? { radiusMm: input.radius_m * 1000 } : {}),
        limit: input.limit ?? 50,
      });
      return text({
        total: found.total,
        returned: found.items.length,
        ...(found.truncated
          ? {
              note: `The nearest ${found.items.length} of ${found.total} are shown; the rest were left out. Narrow it with radius_m or kind.`,
            }
          : {}),
        items: found.items.map(describe),
      });
    },
  );

  register(
    "context_adopt",
    {
      description: `Brings buildings of the context layer into the model as ordinary elements (each footprint extruded to its height, a slab, tagged with its source), inside your claim and as one undo step. Use it only for neighbours the design really needs as model elements: the layer already shows them and casts their shadows. Only buildings can be adopted, at most ${CONTEXT_ADOPT_MAX} at a time; the layer keeps its own copy.`,
      inputSchema: z.object({
        ids: z.array(z.string()).min(1).max(CONTEXT_ADOPT_MAX).describe("Building ids from context_get"),
      }),
    },
    async ({ ids }) => {
      const taken = new Set(deps.taken());
      const ops: SceneOp[] = [];
      const created: string[] = [];
      for (const id of [...new Set(ids)]) {
        const item = deps.byId(id);
        if (!item)
          return failure(
            `There is no item "${id}" in the context layer. Nothing was adopted. List them with context_get.`,
          );
        if (item.kind !== "building")
          return failure(
            `"${id}" is a ${item.kind}; only buildings can be adopted into the model. Nothing was adopted.`,
          );
        const elementId = `ctx-${id.replace(/[^A-Za-z0-9_-]/g, "-")}`.slice(0, 64);
        if (taken.has(elementId))
          return failure(`"${id}" is already in the model as "${elementId}". Nothing was adopted.`);
        taken.add(elementId);
        ops.push(adoptOp(item as ContextBuilding, elementId, deps.sourceName(item.source)));
        created.push(elementId);
      }
      const result = apply(ops);
      return result.ok ? text({ adopted: created }) : failure(result.error);
    },
  );

  register(
    "context_clear",
    {
      description:
        "Empties the city context layer: every fetched building, tree and ground raster goes, for the user's own view and everyone's pictures and sun studies. Use it only when the user asked to clear, remove or delete the site context (or the layer). It never touches the model: buildings already adopted as elements stay, and so does the project's site. It cannot be undone, but the data can be fetched again (urban_buildings, urban_vegetation). Says how much it removed.",
      inputSchema: z.object({}),
    },
    async () => text({ cleared: deps.clear() }),
  );
}
