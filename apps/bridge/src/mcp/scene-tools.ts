import { randomUUID } from "node:crypto";
import type { Element, SceneDocument, SceneOp, ViewCamera } from "@aex/protocol";
import { elementBounds, unionBounds } from "@aex/scene";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { AEX_SERVER } from "../agent/agent-config.ts";
import type { PermissionDecision } from "../agent/approvals.ts";

/** At most this many elements come back from one get_elements call. */
const MAX_ELEMENTS = 200;

export interface SceneToolDeps {
  doc(): SceneDocument;
  selection(): string[];
  /** Applies a batch atomically (into the running turn's transaction, if any). */
  apply(ops: SceneOp[]): { ok: true } | { ok: false; error: string };
  setSelection(ids: string[]): void;
  /** What the user is pointing at with the hand, and the camera. */
  userContext(): { pointed: string | null; camera: ViewCamera | null };
  /** A PNG of the current view, from a connected viewer. */
  captureView(): Promise<{ ok: true; png: string } | { ok: false; error: string }>;
  /** Claude Code's permission prompt: whether a tool call may run (resolves when decided). */
  approve(tool: string, input: Record<string, unknown>, toolUseId?: string): Promise<PermissionDecision>;
}

const text = (value: unknown) => ({
  content: [
    { type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) },
  ],
});
const failure = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });
const brief = (e: Element) => ({
  id: e.id,
  name: e.name,
  type: e.type,
  ...(e.level ? { level: e.level } : {}),
});

const ELEMENT_SHAPES = `Lengths are millimetres, Z up. Element shapes (id is optional when creating):
- massing: { type: "massing", name, level?, origin: [x, y, z] (minimum corner), size: [width, depth, height] }
- wall: { type: "wall", name, level?, start: [x, y], end: [x, y], height, thickness } (centred on its baseline, rising from its level)
- column: { type: "column", name, level?, position: [x, y], section: [width, depth], height }
- slab: { type: "slab", name, level?, outline: [[x, y], ...] (counter-clockwise), thickness } (extruded down from its level)
All may have properties: { key: string | number | boolean }.`;

/**
 * The app's own MCP server ("aex"): how the agent reads and changes the shared scene and sees the view. Every
 * write is validated as a whole and applied into the running turn's transaction, so one undo reverts the turn.
 */
export function createSceneMcpServer(deps: SceneToolDeps): McpServer {
  const server = new McpServer({ name: AEX_SERVER, version: "0.1.0" });

  server.registerTool(
    "get_scene_summary",
    {
      description:
        "A compact summary of the scene: levels, element counts by type, and the overall bounding box in millimetres.",
      inputSchema: z.object({}),
    },
    async () => {
      const doc = deps.doc();
      const elements = Object.values(doc.elements);
      const counts: Record<string, number> = {};
      for (const e of elements) counts[e.type] = (counts[e.type] ?? 0) + 1;
      return text({
        name: doc.name,
        units: "mm",
        up: "Z",
        levels: doc.levels,
        counts,
        bounds: unionBounds(elements.map((e) => elementBounds(e, doc.levels))),
      });
    },
  );

  server.registerTool(
    "get_elements",
    {
      description: `Full details of elements: by ids, or filtered by type and level (at most ${MAX_ELEMENTS}). ${ELEMENT_SHAPES}`,
      inputSchema: z.object({
        ids: z.array(z.string()).optional().describe("Element ids"),
        type: z.enum(["massing", "slab", "wall", "column"]).optional(),
        level: z.string().optional().describe("Level id"),
      }),
    },
    async ({ ids, type, level }) => {
      const doc = deps.doc();
      let elements = ids
        ? ids.map((id) => doc.elements[id]).filter((e) => e !== undefined)
        : Object.values(doc.elements);
      if (type) elements = elements.filter((e) => e.type === type);
      if (level) elements = elements.filter((e) => e.level === level);
      const missing = ids?.filter((id) => !doc.elements[id]) ?? [];
      return text({
        elements: elements.slice(0, MAX_ELEMENTS),
        ...(elements.length > MAX_ELEMENTS ? { truncated: true, total: elements.length } : {}),
        ...(missing.length ? { notFound: missing } : {}),
      });
    },
  );

  server.registerTool(
    "get_user_context",
    {
      description:
        'What the user is referring to: the current selection, the element under their hand pointer, and the camera. Call it when they say "this", "that", "here" or "these".',
      inputSchema: z.object({}),
    },
    async () => {
      const doc = deps.doc();
      const { pointed, camera } = deps.userContext();
      const pointedElement = pointed ? doc.elements[pointed] : undefined;
      return text({
        selection: deps
          .selection()
          .map((id) => doc.elements[id])
          .filter((e) => e !== undefined)
          .map(brief),
        pointed: pointedElement ? brief(pointedElement) : null,
        camera,
      });
    },
  );

  server.registerTool(
    "create_elements",
    {
      description: `Creates elements. The whole batch is validated first: if any element is invalid, nothing is created and the error names it. ${ELEMENT_SHAPES}`,
      inputSchema: z.object({ elements: z.array(z.record(z.string(), z.unknown())).min(1) }),
    },
    async ({ elements }) => {
      const created = elements.map((e) => ({
        properties: {},
        ...e,
        id:
          typeof e.id === "string" && e.id
            ? e.id
            : `${String(e.type ?? "element")}-${randomUUID().slice(0, 8)}`,
      }));
      const result = deps.apply(created.map((element) => ({ op: "create", element }) as SceneOp));
      return result.ok ? text({ created: created.map((e) => e.id) }) : failure(result.error);
    },
  );

  server.registerTool(
    "update_elements",
    {
      description: `Changes fields of existing elements (a shallow patch per element). Validated as a whole: if any result is invalid, nothing changes. ${ELEMENT_SHAPES}`,
      inputSchema: z.object({
        updates: z.array(z.object({ id: z.string(), patch: z.record(z.string(), z.unknown()) })).min(1),
      }),
    },
    async ({ updates }) => {
      const result = deps.apply(updates.map(({ id, patch }) => ({ op: "update", id, patch })));
      return result.ok ? text({ updated: updates.map((u) => u.id) }) : failure(result.error);
    },
  );

  server.registerTool(
    "delete_elements",
    {
      description: "Deletes elements by id. If any id does not exist, nothing is deleted.",
      inputSchema: z.object({ ids: z.array(z.string()).min(1) }),
    },
    async ({ ids }) => {
      const result = deps.apply(ids.map((id) => ({ op: "delete", id })));
      return result.ok ? text({ deleted: ids }) : failure(result.error);
    },
  );

  server.registerTool(
    "set_selection",
    {
      description: "Selects elements (shown highlighted to the user). An empty list clears the selection.",
      inputSchema: z.object({ ids: z.array(z.string()) }),
    },
    async ({ ids }) => {
      deps.setSelection(ids);
      return text({ selected: deps.selection() });
    },
  );

  server.registerTool(
    "capture_view",
    {
      description:
        "A PNG image of what the user currently sees in the viewer (longest side at most 1280 px).",
      inputSchema: z.object({}),
    },
    async () => {
      const result = await deps.captureView();
      if (!result.ok) return failure(result.error);
      return { content: [{ type: "image" as const, data: result.png, mimeType: "image/png" }] };
    },
  );

  server.registerTool(
    "approve_tool",
    {
      description:
        "Claude Code's permission prompt tool: asks the user whether a tool call may run. Not for direct use.",
      inputSchema: z.looseObject({
        tool_name: z.string(),
        input: z.record(z.string(), z.unknown()),
        tool_use_id: z.string().optional(),
      }),
    },
    async ({ tool_name, input, tool_use_id }) =>
      text(JSON.stringify(await deps.approve(tool_name, input, tool_use_id))),
  );

  return server;
}
