import {
  type AgentCamera,
  type Element,
  type HeldTarget,
  type LetterMarker,
  MAX_AGENT_CAMERAS,
  PanelDocument,
  type Point3Mm,
  RESERVED_TAG_PREFIX,
  type RhinoObject,
  type RhinoSelected,
  type SceneDocument,
  type SceneOp,
  type Sketch,
  type SunSetting,
  TAG_OWNER,
  TAG_PART,
  TaskScope,
  type ViewCamera,
  ViewRequest,
} from "@hai/protocol";
import { applySteps, elementBounds, sunPosition, type TransformStep, unionBounds } from "@hai/scene";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { HAI_SERVER } from "../agent/agent-config.ts";
import { type AgentEyes, describeCamera, PRESETS, presetCameras } from "../agent/agent-eyes.ts";
import type { PermissionDecision } from "../agent/approvals.ts";
import { countByTag } from "../agent/ownership.ts";
import type { PanelResult } from "../agent/panels.ts";
import type { Caller } from "./agent-tokens.ts";
import { type ContextTools, registerContextTools } from "./context-tools.ts";
import { type GeometryTools, registerGeometryTools } from "./geometry-tools.ts";
import { type OpenDataTools, registerOpenDataTools } from "./open-data-tools.ts";
import { openPanelDescription } from "./panel-api.ts";
import { pythonRunDescription } from "./python-api.ts";
import { RHINO_DOCUMENT_DESCRIPTION, RHINO_RUN_DESCRIPTION, requirementPackages } from "./rhino-tools.ts";
import {
  registerSimulationGeometry,
  registerSurfaceTemperature,
  type SimulationTools,
  type SurfaceTools,
} from "./simulation-tools.ts";
import { failure, text } from "./tool-results.ts";
import { freshId, stopSignal } from "./tool-util.ts";
import { registerUrbanTools, type UrbanTools } from "./urban-tools.ts";
import { registerWeatherTools, type WeatherTools } from "./weather-tools.ts";

/** At most this many elements come back from one get_elements call. */
const MAX_ELEMENTS = 200;

export interface SceneToolDeps {
  doc(): SceneDocument;
  selection(): string[];
  /** Applies a batch atomically (into the calling agent's running turn, if it has one). */
  apply(ops: SceneOp[], agent: string | null): { ok: true } | { ok: false; error: string };
  setSelection(ids: string[]): void;
  /**
   * What the user is pointing at with the hand, and the camera; what the latest request pointed out (a held pinch's
   * target and points, the sketches), and the project's lettered markers.
   */
  userContext(): {
    pointed: string | null;
    camera: ViewCamera | null;
    target?: HeldTarget;
    points?: Point3Mm[];
    sketches?: Sketch[];
    markers?: LetterMarker[];
  };
  /** A PNG of the current view, from a connected viewer. */
  captureView(sun?: SunSetting): Promise<{ ok: true; png: string } | { ok: false; error: string }>;
  /** The team's task board, for the lead's delegate, team_status and cancel_task tools. */
  team?: TeamTools;
  /** Claims, for the tools that read and change them; absent when there is no team. */
  claims?: ClaimTools;
  /** Starting a worker for a part of the calling specialist's own task; absent when there is no team. */
  workers?: WorkerTools;
  /** Showing the user the split of a request before it is handed out. */
  plans?: PlanTools;
  /** Rhino's mirrored objects and selection while the agent models with Rhino; absent otherwise. */
  rhino?: RhinoContext;
  /** The Python workbench: runs a script in the managed environment. */
  python?: PythonTools;
  /** The geometry tools (array along a curve, and OpenCascade's loft, sweep, boolean and offset). */
  geometry?: GeometryTools;
  /** Python in the open Rhino document; present while the agent models with Rhino. */
  rhinoPython?: RhinoPythonTools;
  /** Aborted when the agent ends the request before it is answered (Stop): long tool calls end their work. */
  requestSignal?: AbortSignal;
  /** The agents' own cameras and the pictures from them; they never touch the user's view. */
  eyes?: AgentEyes;
  /** Asks the viewers to move the camera. */
  setView(request: ViewRequest): { ok: true } | { ok: false; error: string };
  /** Generated panels; absent while the Generated panels feature is switched off. */
  panels?: PanelTools;
  /** Open data (the sources and the project's site); absent while the Open data switch is off. */
  openData?: OpenDataTools;
  /** The city context layer (read-only, outside the model). */
  context?: ContextTools;
  /** Urban's open-data tools (portals, buildings, vegetation, metrics); absent while Open data is off. */
  urban?: UrbanTools;
  /** The weather and climate tools; absent while Open data is off. */
  weather?: WeatherTools;
  /** The model as a simulation description (reads the model only). */
  simulation?: SimulationTools;
  /** The ground's surface temperature (open data); absent while Open data is off. */
  surface?: SurfaceTools;
  /** Claude Code's permission prompt: whether a tool call may run (resolves when decided). */
  approve(
    tool: string,
    input: Record<string, unknown>,
    toolUseId: string | undefined,
    agent: string | null,
  ): Promise<PermissionDecision>;
}

/** What the lead's `confirm_plan` does (see agent/plans.ts). */
export interface PlanTools {
  ask(parts: Array<{ agent: string; title: string; scope?: TaskScope | undefined }>): Promise<{
    outcome: "confirmed" | "skipped" | "expired";
    keep: Array<{ agent: string; title: string; scope?: TaskScope | undefined }>;
  }>;
}

/** What a specialist's `spawn_worker` does (see agent/team.ts). */
export interface WorkerTools {
  spawn(
    agent: string,
    input: { title: string; instruction: string; scope: TaskScope },
  ):
    | { ok: true; worker: string; taskId: string; status: "running" | "queued"; note?: string }
    | { ok: false; error: string };
}

/** What `python_run` does (see python/python-run.ts). */
export interface PythonTools {
  run(
    input: {
      code: string;
      title: string;
      packages: string[];
      outputs?: string[] | undefined;
      timeoutMs: number;
      agent: string | null;
    },
    signal: AbortSignal,
  ): Promise<{
    ok: boolean;
    stdout: string;
    result?: string;
    error?: string;
    durationMs: number;
    script: string;
    written: Array<{ path: string; size: number }>;
    undeclared?: Array<{ path: string; size: number }>;
    stopped?: boolean;
    timedOut?: boolean;
  }>;
}

/** What the Rhino tools do (see rhino-link.ts). */
export interface RhinoPythonTools {
  run(
    input: { code: string; title: string; timeoutMs: number; agent: string | null },
    signal: AbortSignal,
  ): Promise<{
    ok: boolean;
    stdout: string;
    result?: string;
    error?: string;
    durationMs: number;
    script: string | null;
    /** What the run did outside the agent's claim, found after it ran. */
    outsideClaim?: string;
  }>;
  /** Reads the open document (units, layers, counts, selection, active view) as text. */
  document(signal: AbortSignal): Promise<{ ok: true; json: string } | { ok: false; error: string }>;
}

/** What the user context says about Rhino. */
export interface RhinoContext {
  /** The mirrored Rhino object with this id (the one under the pointer), if there is one. */
  object(id: string): RhinoObject | undefined;
  /** Every mirrored Rhino object, to list them by owner, part or tag. */
  objects(): RhinoObject[];
  selection(): RhinoSelected[];
}

/** What the panel tools do for one agent (see panels.ts). */
export interface PanelTools {
  offer(
    purpose: string,
  ): Promise<PanelResult<{ answer: "accepted" | "skipped" | "expired"; waitedMs: number }>>;
  open(document: PanelDocument): Promise<PanelResult>;
  update(patch: Partial<PanelDocument>): Promise<PanelResult>;
  close(): PanelResult;
}

/** What the claim tools do for one agent (see team.ts). */
export interface ClaimTools {
  /** The running claims, the tasks waiting for one, and the shared brief. */
  list(agent: string): unknown;
  /** Adds to the agent's claim when nothing else holds it. */
  request(agent: string, scope: TaskScope): { ok: true; scope: string } | { ok: false; error: string };
  /** Gives part of the agent's claim back. */
  release(
    agent: string,
    release: { ids?: string[] | undefined; part?: boolean | undefined; region?: boolean | undefined },
  ): { ok: true; scope: string } | { ok: false; error: string };
  /** Which of these elements the user changed since the agent last read them. */
  userChanges(agent: string, ids: string[]): Set<string>;
}

/** What the lead's team tools do (see team.ts). */
export interface TeamTools {
  /** Whether the team has a specialist with this name. */
  has?(name: string): boolean;
  delegate(task: {
    agent: string;
    title: string;
    instruction: string;
    scope?: TaskScope | undefined;
    brief?: string | undefined;
  }): { ok: true; taskId: string; status: string; note?: string } | { ok: false; error: string };
  status(): unknown;
  cancel(taskId: string): { ok: true; status: string } | { ok: false; error: string };
}

const brief = (e: Element) => ({
  id: e.id,
  name: e.name,
  type: e.type,
  ...(e.level ? { level: e.level } : {}),
  ...(e.type === "imported" && e.layer ? { layer: e.layer } : {}),
});

const COMPASS = [
  "N",
  "NNE",
  "NE",
  "ENE",
  "E",
  "ESE",
  "SE",
  "SSE",
  "S",
  "SSW",
  "SW",
  "WSW",
  "W",
  "WNW",
  "NW",
  "NNW",
];

/** The tool's steps as the scene package takes them (a move may leave out its height). */
const stepsOf = (steps: Array<Record<string, unknown>>): TransformStep[] =>
  steps.map((step) => {
    if (step.kind === "translate") {
      const [x = 0, y = 0, z = 0] = step.by as number[];
      return { kind: "translate", by: [x, y, z] };
    }
    return step as unknown as TransformStep;
  });

/** The name an agent's cameras are kept under. */
const callerName = (caller: Caller) => caller.agent ?? "agent";

/** The compass point an azimuth is nearest. */
const compass = (azimuth: number) => COMPASS[Math.round(azimuth / 22.5) % 16] as string;

const ELEMENT_SHAPES = `Lengths are millimetres, Z up. Element shapes (id is optional when creating):
- massing: { type: "massing", name, level?, origin: [x, y, z] (minimum corner), size: [width, depth, height], rotationDeg? (turned counter-clockwise about its centre in plan) }
- wall: { type: "wall", name, level?, start: [x, y], end: [x, y], height, thickness } (centred on its baseline, rising from its level)
- column: { type: "column", name, level?, position: [x, y], section: [width, depth], height, rotationDeg? (about its position) }
- slab: { type: "slab", name, level?, outline: [[x, y], ...] (counter-clockwise), thickness } (extruded down from its level)
- line: { type: "line", name, level?, points: [[x, y, z], ...] (at least 2, at their real heights), closed? } (a polyline the user drew or a curve for you to use as a path, a rail or a guide; it is a curve, not a solid)
- imported: reference geometry from the user's Rhino file: { type: "imported", name, layer?, color?, bounds: { min: [x, y, z], max: [x, y, z] } (before translation), translation: [x, y, z], rotationDeg? (about the centre of its box in plan), scale? (about the foot of its box centre) }. You see its box, never its triangles. Move, turn and scale it with transform_elements (or change translation, rotationDeg and scale); delete it as any element; copy it by creating another with the same asset, part and bounds. You cannot change its shape.
Walls, slabs and columns may also have base: the height of their base in millimetres, which wins over their level's elevation (for elements placed off any level, such as on a roof).
All may have properties: { key: string | number | boolean }.`;

/**
 * The app's own MCP server ("hai"): how the agent reads and changes the shared scene and sees the view. Every
 * write is validated as a whole and applied into the running turn's transaction, so one undo reverts the turn.
 * The server offers only the calling agent's tools (and the permission prompt tool, which Claude Code itself calls),
 * so an agent without write tools cannot change the model whatever it asks for.
 */
export function createSceneMcpServer(deps: SceneToolDeps, caller: Caller): McpServer {
  const server = new McpServer({ name: HAI_SERVER, version: "0.1.0" });
  const registered = new Map<string, { remove(): void }>();
  // registerTool, remembering each tool so the ones this agent may not call can be removed at the end.
  const register = ((name: string, config: never, callback: never) => {
    const tool = server.registerTool(name, config, callback);
    registered.set(name, tool);
    return tool;
  }) as McpServer["registerTool"];

  register(
    "get_scene_summary",
    {
      description:
        "A compact summary of the scene: levels, element counts by type, how many elements each owner (the agent that made or last took over the element) and each part holds, and the overall bounding box in millimetres.",
      inputSchema: z.object({}),
    },
    async () => {
      const doc = deps.doc();
      const elements = Object.values(doc.elements);
      const counts: Record<string, number> = {};
      for (const e of elements) counts[e.type] = (counts[e.type] ?? 0) + 1;
      const owners = countByTag(doc, TAG_OWNER);
      const parts = countByTag(doc, TAG_PART);
      const rhinoObjects = deps.rhino?.objects() ?? [];
      const rhinoTags = (name: string) => {
        const tally: Record<string, number> = {};
        for (const o of rhinoObjects) {
          const value = o.tags[name];
          if (value !== undefined) tally[value] = (tally[value] ?? 0) + 1;
        }
        return tally;
      };
      return text({
        name: doc.name,
        units: "mm",
        up: "Z",
        levels: doc.levels,
        counts,
        owners: owners.counts,
        withoutOwner: owners.without,
        parts: parts.counts,
        withoutPart: parts.without,
        ...(deps.rhino
          ? {
              rhino: {
                objects: rhinoObjects.length,
                owners: rhinoTags(TAG_OWNER),
                parts: rhinoTags(TAG_PART),
              },
            }
          : {}),
        bounds: unionBounds(elements.map((e) => elementBounds(e, doc.levels))),
      });
    },
  );

  register(
    "get_elements",
    {
      description: `Full details of elements, with their tags: by ids, or filtered by type, level, owner (the agent that made or last took over the element), part or tag (at most ${MAX_ELEMENTS}). While Rhino is connected the Rhino objects that match are listed too, under rhinoObjects. An element the user changed by hand since you last read it is marked changedByUser. ${ELEMENT_SHAPES}`,
      inputSchema: z.object({
        ids: z.array(z.string()).optional().describe("Element ids"),
        type: z.enum(["massing", "slab", "wall", "column", "line", "imported"]).optional(),
        level: z.string().optional().describe("Level id"),
        owner: z.string().optional().describe("An agent's name, e.g. architect"),
        part: z.string().optional().describe("A part name (the hai.part tag)"),
        tag: z
          .object({ name: z.string(), value: z.string().optional() })
          .optional()
          .describe("A tag name, and optionally the value it must have"),
      }),
    },
    async ({ ids, type, level, owner, part, tag }) => {
      const doc = deps.doc();
      const tagged = (tags: Record<string, string> | undefined) =>
        (owner === undefined || tags?.[TAG_OWNER] === owner) &&
        (part === undefined || tags?.[TAG_PART] === part) &&
        (tag === undefined ||
          (tag.value === undefined ? tags?.[tag.name] !== undefined : tags?.[tag.name] === tag.value));
      let elements = ids
        ? ids.map((id) => doc.elements[id]).filter((e) => e !== undefined)
        : Object.values(doc.elements);
      if (type) elements = elements.filter((e) => e.type === type);
      if (level) elements = elements.filter((e) => e.level === level);
      elements = elements.filter((e) => tagged(e.tags));
      const missing = ids?.filter((id) => !doc.elements[id]) ?? [];
      const shown = elements.slice(0, MAX_ELEMENTS);
      const changed = caller.agent
        ? (deps.claims?.userChanges(
            caller.agent,
            shown.map((e) => e.id),
          ) ?? new Set<string>())
        : new Set<string>();
      const filtered = owner !== undefined || part !== undefined || tag !== undefined;
      const rhinoObjects =
        deps.rhino && filtered && !ids
          ? deps.rhino
              .objects()
              .filter((o) => tagged(o.tags))
              .slice(0, MAX_ELEMENTS)
              .map((o) => ({ id: o.id, name: o.name, type: o.type, layer: o.layer, tags: o.tags }))
          : [];
      return text({
        elements: shown.map((e) => (changed.has(e.id) ? { ...e, changedByUser: true } : e)),
        ...(elements.length > MAX_ELEMENTS ? { truncated: true, total: elements.length } : {}),
        ...(missing.length ? { notFound: missing } : {}),
        ...(rhinoObjects.length ? { rhinoObjects } : {}),
      });
    },
  );

  register(
    "get_user_context",
    {
      description:
        'What the user is referring to: the current selection, the element under their hand pointer, and the camera; what their latest request pointed out (the target of a held pinch, "this"; the points P1, P2 the hand rested on, "here" and "there"; the sketches S1, S2 they drew, paths and outlines in millimetres); and the lettered markers A, B of the project. Call it when they say "this", "that", "here", "there", "these", a sketch or a marker.',
      inputSchema: z.object({}),
    },
    async () => {
      const doc = deps.doc();
      const { pointed, camera, target, points, sketches, markers } = deps.userContext();
      const pointedElement = pointed ? doc.elements[pointed] : undefined;
      const pointedRhino = pointed ? deps.rhino?.object(pointed) : undefined;
      return text({
        ...(deps.rhino
          ? {
              rhino: {
                pointed: pointedRhino
                  ? {
                      id: pointedRhino.id,
                      name: pointedRhino.name,
                      type: pointedRhino.type,
                      layer: pointedRhino.layer,
                      tags: pointedRhino.tags,
                    }
                  : null,
                selection: deps.rhino.selection(),
              },
            }
          : {}),
        selection: deps
          .selection()
          .map((id) => doc.elements[id])
          .filter((e) => e !== undefined)
          .map(brief),
        pointed: pointedElement ? brief(pointedElement) : null,
        camera,
        ...(target ? { target } : {}),
        ...(points?.length ? { points: points.map((p, i) => ({ label: `P${i + 1}`, point: p })) } : {}),
        ...(sketches?.length ? { sketches } : {}),
        markers: markers ?? [],
      });
    },
  );

  register(
    "create_elements",
    {
      description: `Creates elements. The whole batch is validated first: if any element is invalid, nothing is created and the error names it. ${ELEMENT_SHAPES}`,
      inputSchema: z.object({ elements: z.array(z.record(z.string(), z.unknown())).min(1) }),
    },
    async ({ elements }) => {
      const doc = deps.doc();
      const taken = new Set(Object.keys(doc.elements));
      const created: Array<Record<string, unknown> & { id: string }> = [];
      for (const e of elements) {
        const id = typeof e.id === "string" && e.id ? e.id : freshId(e.type, taken);
        const existing = doc.elements[id];
        if (existing || created.some((c) => c.id === id)) {
          const owner = existing?.tags?.[TAG_OWNER];
          return failure(
            `Element "${id}" already exists${owner ? ` and belongs to ${owner}` : ""}. Nothing was created. Choose another id, or leave the id out and one is made for you.`,
          );
        }
        taken.add(id);
        created.push({ properties: {}, ...e, id });
      }
      const result = deps.apply(
        created.map((element) => ({ op: "create", element }) as SceneOp),
        caller.agent,
      );
      return result.ok ? text({ created: created.map((e) => e.id) }) : failure(result.error);
    },
  );

  register(
    "update_elements",
    {
      description: `Changes fields of existing elements (a shallow patch per element). Validated as a whole: if any result is invalid, nothing changes. ${ELEMENT_SHAPES}`,
      inputSchema: z.object({
        updates: z.array(z.object({ id: z.string(), patch: z.record(z.string(), z.unknown()) })).min(1),
      }),
    },
    async ({ updates }) => {
      const result = deps.apply(
        updates.map(({ id, patch }) => ({ op: "update", id, patch })),
        caller.agent,
      );
      return result.ok ? text({ updated: updates.map((u) => u.id) }) : failure(result.error);
    },
  );

  register(
    "transform_elements",
    {
      description:
        "Moves, turns, scales or mirrors elements, whatever their type, in one change. Steps run in order, each on what the one before left. A rotate, scale or mirror turns about the centre of the elements together unless it names a point. With copies: N the originals stay and N copies are made, copy i being the originals put through the steps i times (copy 4 times 6 m along y: one translate step of [0, 6000, 0] and copies 4). Lengths are millimetres, angles degrees counter-clockwise seen from above. An imported model cannot be mirrored.",
      inputSchema: z.object({
        ids: z.array(z.string()).min(1),
        steps: z
          .array(
            z.discriminatedUnion("kind", [
              z.object({ kind: z.literal("translate"), by: z.array(z.number()).min(2).max(3) }),
              z.object({
                kind: z.literal("rotate"),
                deg: z.number(),
                about: z.array(z.number()).length(2).optional(),
              }),
              z.object({
                kind: z.literal("scale"),
                factor: z.number().positive(),
                about: z.array(z.number()).length(3).optional(),
              }),
              z.object({ kind: z.literal("mirror"), axis: z.enum(["x", "y"]), at: z.number().optional() }),
            ]),
          )
          .min(1),
        copies: z.number().int().min(1).max(200).optional(),
      }),
    },
    async ({ ids, steps, copies }) => {
      const doc = deps.doc();
      const elements = ids.map((id) => doc.elements[id]);
      const missing = ids.filter((_, i) => !elements[i]);
      if (missing.length) return failure(`Nothing was changed: no element ${missing.join(", ")}.`);
      const found = elements as Element[];
      const run = (times: number) =>
        applySteps(found, Array.from({ length: times }, () => stepsOf(steps)).flat(), doc.levels);
      if (!copies) {
        const done = run(1);
        if (!done.ok) return failure(`Nothing was changed: ${done.error}`);
        const result = deps.apply(
          Object.entries(done.patches).map(([id, patch]): SceneOp => ({ op: "update", id, patch })),
          caller.agent,
        );
        return result.ok ? text({ transformed: ids }) : failure(result.error);
      }
      const taken = new Set(Object.keys(doc.elements));
      const created: SceneOp[] = [];
      const createdIds: string[] = [];
      for (let i = 1; i <= copies; i++) {
        const done = run(i);
        if (!done.ok) return failure(`Nothing was changed: ${done.error}`);
        for (const element of found) {
          const id = freshId(element.type, taken);
          taken.add(id);
          createdIds.push(id);
          // The copy is the agent's own: the system's tags (owner, part, source) are not carried over.
          const tags = Object.fromEntries(
            Object.entries(element.tags ?? {}).filter(([name]) => !name.startsWith(RESERVED_TAG_PREFIX)),
          );
          created.push({
            op: "create",
            element: { ...element, ...done.patches[element.id], id, tags } as Element,
          });
        }
      }
      const result = deps.apply(created, caller.agent);
      return result.ok ? text({ created: createdIds }) : failure(result.error);
    },
  );

  register(
    "delete_elements",
    {
      description: "Deletes elements by id. If any id does not exist, nothing is deleted.",
      inputSchema: z.object({ ids: z.array(z.string()).min(1) }),
    },
    async ({ ids }) => {
      const result = deps.apply(
        ids.map((id) => ({ op: "delete", id })),
        caller.agent,
      );
      return result.ok ? text({ deleted: ids }) : failure(result.error);
    },
  );

  register(
    "set_tags",
    {
      description: `Sets or removes your own tags on elements (labels such as "style" = "gothic"). A value of null removes a tag. Names starting with "${RESERVED_TAG_PREFIX}" belong to the system and are refused. Like any change it must lie inside your claim.`,
      inputSchema: z.object({
        ids: z.array(z.string()).min(1),
        tags: z.record(z.string(), z.string().nullable()),
      }),
    },
    async ({ ids, tags }) => {
      const doc = deps.doc();
      const unknown = ids.filter((id) => !doc.elements[id]);
      if (unknown.length) return failure(`Nothing was changed: no element ${unknown.join(", ")}.`);
      const updates = ids.map((id): SceneOp => {
        const merged: Record<string, string> = { ...(doc.elements[id]?.tags ?? {}) };
        for (const [name, value] of Object.entries(tags)) {
          if (value === null) delete merged[name];
          else merged[name] = value;
        }
        return { op: "update", id, patch: { tags: merged } };
      });
      const result = deps.apply(updates, caller.agent);
      return result.ok ? text({ tagged: ids }) : failure(result.error);
    },
  );

  register(
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

  const { claims } = deps;
  if (claims) {
    const agent = caller.agent ?? "";
    register(
      "get_claims",
      {
        description:
          "Who is working on which part of the model right now: every running claim (agent, task, scope, how many elements it holds), the tasks waiting for one, and the brief shared by this request's tasks. Read it before you change anything near another agent's work.",
        inputSchema: z.object({}),
      },
      async () => text(claims.list(agent)),
    );

    register(
      "request_claim",
      {
        description:
          "Asks for more scope for your task: element ids, a part, or a region (a box in millimetres). Granted at once when nothing else holds it, and refused naming the holder otherwise. Use it when a change you need is refused as outside your claim.",
        inputSchema: z.object({ scope: TaskScope }),
      },
      async ({ scope }) => {
        const result = claims.request(agent, scope);
        return result.ok ? text({ granted: true, yourClaim: result.scope }) : failure(result.error);
      },
    );

    register(
      "release_claim",
      {
        description:
          "Gives back part of your claim (listed ids, the part, or the region) so queued tasks can use it. You keep the rest; to give up everything, finish your task.",
        inputSchema: z.object({
          ids: z.array(z.string()).optional(),
          part: z.boolean().optional(),
          region: z.boolean().optional(),
        }),
      },
      async (release) => {
        const result = claims.release(agent, release);
        return result.ok ? text({ released: true, yourClaim: result.scope }) : failure(result.error);
      },
    );
  }

  register(
    "capture_view",
    {
      description:
        "A PNG image of what the USER currently sees in the viewer, with their camera, selection and hover (longest side at most 1280 px). To check your own work, use your own cameras (camera_capture) instead: they never disturb the user.",
      inputSchema: z.object({}),
    },
    async () => {
      const result = await deps.captureView();
      if (!result.ok) return failure(result.error);
      return { content: [{ type: "image" as const, data: result.png, mimeType: "image/png" }] };
    },
  );

  const { workers } = deps;
  if (workers) {
    register(
      "spawn_worker",
      {
        description:
          'Starts a worker for one part of YOUR OWN task, so the parts are made at the same time. The worker is another session of you (its own name, such as architect.2): it gets only the instruction you write here (it does not see your conversation, so include sizes in millimetres, ids and what the parts must agree on), works inside the scope you give it, and its work is its own undo step. Returns at once; you are told how each worker ended, and your task ends after the last one. The scope is a part of what YOUR task holds and must not overlap your other workers: `part` (when your claim is a part, a worker\'s part is written "<your part>/<name>", e.g. "pavilion/dome"), `ids` (elements your claim takes in) or `region` (a box inside your region), or a mix. While a worker runs you cannot change its part; do the rest yourself. Workers cannot start workers. Each worker is a model session with its own cost, and the number running at once is limited: one over the limit waits for a free session.',
        inputSchema: z.object({
          title: z.string().min(1).max(80).describe('A short title for the part, e.g. "Dome"'),
          instruction: z.string().min(1).max(8000),
          scope: TaskScope.describe("The part of your task's claim this worker may change"),
        }),
      },
      async (input) => {
        const result = workers.spawn(callerName(caller), input);
        return result.ok
          ? text({
              worker: result.worker,
              taskId: result.taskId,
              status: result.status,
              ...(result.note ? { note: result.note } : {}),
            })
          : failure(result.error);
      },
    );
  }

  const { team } = deps;
  if (team) {
    register(
      "delegate",
      {
        description:
          "Hands a task to a specialist of the team. Returns at once with the task id; the specialist works on it in its own session, and you are told when it has finished. Give each task a short title and a complete instruction: the specialist does not see your conversation, so include what the user pointed at or selected (element ids) and sizes in millimetres. Quote the user's own words in the instruction, especially anything about how they want to work (for example that they want to tune or try values themselves): the specialist decides from it how to help, and cannot know what you leave out. When a request spans separate parts of the model (a dome and a garden, two floors), hand out one task per part, each with a scope that does not overlap the others, and set one brief for all of them: tasks with separate scopes work at the same time, each in its own undo step, while a task with no scope takes the whole model and runs alone. A scope is the part of the model the task may change: `part` (a name; the specialist's new elements are tagged with it), `ids` (existing element ids), `region` (a box in millimetres, `min` and `max` as [x, y] or [x, y, z]), or a mix. Write the brief before you hand out, and say what the parts must agree on (the datum, the grid, key dimensions, colours, style): it is given to every task of this request and each agent can read it again.",
        inputSchema: z.object({
          agent: z.string().describe("The specialist's name, as in your team list"),
          title: z.string().min(1).max(80).describe('A short title, e.g. "Stair core"'),
          instruction: z.string().min(1).max(8000),
          scope: TaskScope.optional().describe(
            "The part of the model this task may change; leave out to give it the whole model",
          ),
          brief: z
            .string()
            .min(1)
            .max(2000)
            .optional()
            .describe(
              "Shared decisions for every task of this request; the latest brief replaces earlier ones",
            ),
        }),
      },
      async (task) => {
        const result = team.delegate(task);
        return result.ok
          ? text({
              taskId: result.taskId,
              status: result.status,
              ...(result.note ? { note: result.note } : {}),
            })
          : failure(result.error);
      },
    );

    register(
      "team_status",
      {
        description:
          "What every agent of the team is doing now: its state, its current task with the latest activity, its queued tasks, and recently finished tasks with their summaries.",
        inputSchema: z.object({}),
      },
      async () => text(team.status()),
    );

    register(
      "confirm_plan",
      {
        description:
          "Shows the user how you mean to split a request, before you hand anything out: one line per part with the agent who would do it, its title and where. The user removes the parts they do not want and confirms, or skips the plan; this call waits for the answer (at most two minutes) and returns the parts to hand out. Use it when the request splits into three or more parts or the split is a judgement the user may want to change; hand out small, obvious splits directly. Then call delegate only for the parts it returns, with the scopes you planned. If the user skipped it, hand out nothing and ask what they want.",
        inputSchema: z.object({
          parts: z
            .array(
              z.object({
                agent: z.string().describe("The specialist's name, as in your team list"),
                title: z.string().min(1).max(80),
                scope: TaskScope.optional().describe("What the part may change, as for delegate"),
              }),
            )
            .min(1)
            .max(12),
        }),
      },
      async ({ parts }) => {
        const { plans } = deps;
        if (!plans) return failure("Plans are not available in this session.");
        const unknown = parts.filter((p) => deps.team?.has?.(p.agent.trim().toLowerCase()) === false);
        if (unknown.length > 0)
          return failure(
            `There is no specialist called ${unknown.map((p) => p.agent).join(", ")}. Use the names in your team list.`,
          );
        const answer = await plans.ask(parts.map((p) => ({ ...p, agent: p.agent.trim().toLowerCase() })));
        const next = {
          confirmed:
            "The user confirmed these parts. Hand out exactly these with delegate, each with its scope.",
          skipped: "The user skipped the plan. Hand nothing out; ask what they would like instead.",
          expired: "The user did not answer. Hand nothing out; ask in chat whether to go ahead.",
        }[answer.outcome];
        return text({ outcome: answer.outcome, parts: answer.keep, next });
      },
    );

    register(
      "cancel_task",
      {
        description:
          "Stops a running task or takes a queued one off the queue. What a stopped task already changed stays, as one undo step.",
        inputSchema: z.object({ taskId: z.string() }),
      },
      async ({ taskId }) => {
        const result = team.cancel(taskId);
        return result.ok ? text({ taskId, status: result.status }) : failure(result.error);
      },
    );
  }

  const { panels } = deps;
  if (panels) {
    const issues = (error: { issues: Array<{ path: PropertyKey[]; message: string }> }) =>
      error.issues.map((i) => `${i.path.join(".") || "document"}: ${i.message}`).join("; ");

    register(
      "offer_panel",
      {
        description:
          'Asks the user whether they want a small panel for this task (for example sliders for a clearance and its tolerance). Offer one when the request is about tolerances, ranges or parameters the user will want to feel out, or when they say they want to tune, adjust or try values themselves, and do so before you change the model for them; do not offer for one-off edits. The user answers with a nod, a click or a shake, and this call waits for the answer (at most a minute): "accepted" (now call open_panel), "skipped" (carry on in chat) or "expired". If another agent\'s panel or offer is showing, your offer waits behind it (at most two wait, and at most a minute) and you are told how long you waited; you cannot have two offers at once, nor offer while a panel of yours is open. Every agent may offer a panel; if you cannot change the model, yours is information only (a table, a chart, a comparison, a summary the user reads at a glance).',
        inputSchema: z.object({
          purpose: z
            .string()
            .trim()
            .min(1)
            .max(200)
            .describe('What the panel is for, shown to the user, e.g. "Set the wall to column clearance"'),
        }),
      },
      async ({ purpose }) => {
        const result = await panels.offer(purpose);
        if (!result.ok) return failure(result.error);
        const next = {
          accepted: "The user accepted. Call open_panel now.",
          skipped: "The user skipped the panel. Carry on in chat.",
          expired: "The user did not answer. Carry on in chat.",
        }[result.answer];
        const waited = Math.round(result.waitedMs / 1000);
        return text({
          answer: result.answer,
          next,
          ...(waited >= 1
            ? {
                waitedSeconds: waited,
                note: "Another agent's panel was showing, so your offer waited its turn.",
              }
            : {}),
        });
      },
    );

    register(
      "open_panel",
      {
        description: openPanelDescription(ELEMENT_SHAPES),
        inputSchema: z.object({
          title: z.string().describe("Shown in the panel's header, up to 80 characters"),
          width: z.number().optional().describe("Pixels, 200-720 (default 320)"),
          height: z.number().optional().describe("Pixels, 120-720 (default 240)"),
          html: z.string().describe("One self-contained HTML document"),
        }),
      },
      async (input) => {
        const parsed = PanelDocument.safeParse({ width: 320, height: 240, ...input });
        if (!parsed.success) return failure(`The panel was not opened. ${issues(parsed.error)}`);
        const result = await panels.open(parsed.data);
        return result.ok ? text({ status: "ready" }) : failure(result.error);
      },
    );

    register(
      "update_panel",
      {
        description:
          "Replaces the open panel's document (and optionally its title and size) with a new one, for example to fix an error open_panel reported or to change what it offers. The user's uncommitted preview is discarded. Needs no new offer. Same document rules as open_panel.",
        inputSchema: z.object({
          html: z.string().describe("One self-contained HTML document"),
          title: z.string().optional(),
          width: z.number().optional(),
          height: z.number().optional(),
        }),
      },
      async (input) => {
        const parsed = PanelDocument.partial().safeParse(input);
        if (!parsed.success) return failure(`The panel was not updated. ${issues(parsed.error)}`);
        const result = await panels.update(parsed.data);
        return result.ok ? text({ status: "ready" }) : failure(result.error);
      },
    );

    register(
      "close_panel",
      {
        description:
          "Closes the open panel and discards anything the user had not kept. Use it when the panel is no longer needed; the user can also close it themselves.",
        inputSchema: z.object({}),
      },
      async () => {
        const result = panels.close();
        return result.ok ? text({ status: "closed" }) : failure(result.error);
      },
    );
  }

  if (deps.openData) registerOpenDataTools(register, deps.openData);
  if (deps.urban) registerUrbanTools(register, deps.urban);
  if (deps.weather) registerWeatherTools(register, deps.weather);
  if (deps.simulation) registerSimulationGeometry(register, deps.simulation);
  if (deps.surface) registerSurfaceTemperature(register, deps.surface);
  if (deps.context) registerContextTools(register, deps.context, (ops) => deps.apply(ops, caller.agent));

  if (deps.geometry)
    registerGeometryTools(
      register,
      {
        doc: deps.doc,
        apply: deps.apply,
        geometry: deps.geometry,
        requestSignal: deps.requestSignal,
      },
      caller,
    );

  const { python, rhinoPython } = deps;
  if (python) {
    register(
      "python_run",
      {
        description: pythonRunDescription(),
        inputSchema: z.object({
          code: z.string().min(1).max(200_000).describe("The Python 3 script"),
          title: z.string().trim().min(1).max(80).describe('A short title, e.g. "Freeform canopy"'),
          packages: z
            .array(z.string())
            .max(20)
            .optional()
            .describe('Extra packages to install first, e.g. ["shapely"]; the user approves the list'),
          outputs: z
            .array(z.string().min(1).max(260))
            .max(20)
            .optional()
            .describe(
              'The .3dm files the script will write, as paths inside the project, e.g. ["canopy.3dm"]. Always give them: they are reserved for your task (a name another task has reserved is refused), and only these are offered to the user.',
            ),
          timeoutSeconds: z.number().int().min(1).max(600).optional().describe("Default 60"),
        }),
      },
      async ({ code, title, packages, outputs, timeoutSeconds }, ctx) => {
        const out = await python.run(
          {
            code,
            title,
            packages: packages ?? [],
            outputs,
            timeoutMs: (timeoutSeconds ?? 60) * 1000,
            agent: caller.agent,
          },
          stopSignal(ctx.mcpReq.signal, deps.requestSignal),
        );
        const body = {
          ok: out.ok,
          output: out.stdout,
          ...(out.result !== undefined ? { result: out.result } : {}),
          ...(out.error ? { error: out.error } : {}),
          durationMs: out.durationMs,
          script: out.script,
          ...(out.written.length > 0
            ? {
                filesWritten: out.written.map((f) => f.path),
                next: "The user can import a written .3dm into the viewer with one click.",
              }
            : {}),
          ...(out.undeclared?.length
            ? {
                writtenOutsideDeclaration: out.undeclared.map((f) => f.path),
                warning:
                  "These .3dm files changed while your script ran but are not in outputs, so they are not offered to the user (another task's run may have written them). Declare every file you write.",
              }
            : {}),
        };
        return out.ok ? text(body) : failure(JSON.stringify(body, null, 2));
      },
    );
  }

  if (rhinoPython) {
    register(
      "rhino_run_python",
      {
        description: RHINO_RUN_DESCRIPTION,
        inputSchema: z.object({
          code: z
            .string()
            .min(1)
            .max(200_000)
            .describe("The Python 3 script; '# r: package' lines name packages"),
          title: z.string().trim().min(1).max(80).describe('A short title, e.g. "Loft the canopy"'),
          timeoutSeconds: z.number().int().min(1).max(600).optional().describe("Default 60"),
        }),
      },
      async ({ code, title, timeoutSeconds }, ctx) => {
        const requirements = requirementPackages(code);
        if (requirements.invalid.length > 0) {
          return failure(
            `These "# r:" requirements are not package names pip can install: ${requirements.invalid.join(", ")}.`,
          );
        }
        const out = await rhinoPython.run(
          { code, title, timeoutMs: (timeoutSeconds ?? 60) * 1000, agent: caller.agent },
          stopSignal(ctx.mcpReq.signal, deps.requestSignal),
        );
        const body = {
          ok: out.ok,
          output: out.stdout,
          ...(out.result !== undefined ? { result: out.result } : {}),
          ...(out.error ? { error: out.error } : {}),
          durationMs: out.durationMs,
          ...(out.script ? { script: out.script } : {}),
          ...(out.outsideClaim ? { outsideYourClaim: out.outsideClaim } : {}),
        };
        return out.ok ? text(body) : failure(JSON.stringify(body, null, 2));
      },
    );

    register(
      "rhino_get_document",
      { description: RHINO_DOCUMENT_DESCRIPTION, inputSchema: z.object({}) },
      async (_input, ctx) => {
        const out = await rhinoPython.document(stopSignal(ctx.mcpReq.signal, deps.requestSignal));
        return out.ok ? text(out.json) : failure(out.error);
      },
    );
  }

  register(
    "set_view",
    {
      description:
        "Moves the user's camera in the 3D view: turn it (azimuth in degrees around the target, counter-clockwise from east: 0 from the east, 90 from the north, 180 from the west, 270 from the south, 225 from the south-west), tilt it (elevation 5 to 89 degrees above the horizon), move it nearer or further (distance in millimetres from the target), look at a point (target, millimetres) or frame elements (their ids, including Rhino objects). Give at least one; what you leave out stays. The view animates there over under a second and gives way at once if the user orbits. It changes nothing in the model. This moves the USER's camera: use it only to show the user something they asked to see. To look at the model yourself, use your own cameras (camera_set, camera_capture), which leave the user's view alone.",
      inputSchema: z.object({
        azimuth: z
          .number()
          .optional()
          .describe("Degrees counter-clockwise from east (+X): 90 from the north, 225 from the south-west"),
        elevation: z.number().optional().describe("Degrees above the horizon, 5 to 89"),
        distance: z.number().optional().describe("Millimetres from the target"),
        target: z
          .tuple([z.number(), z.number(), z.number()])
          .optional()
          .describe("A point to look at, millimetres"),
        frame: z.array(z.string()).optional().describe("Element or Rhino object ids to bring into view"),
      }),
    },
    async (input) => {
      const parsed = ViewRequest.safeParse(input);
      if (!parsed.success) return failure(parsed.error.issues.map((i) => i.message).join("; "));
      const result = deps.setView(parsed.data);
      return result.ok ? text({ status: "moving", ...parsed.data }) : failure(result.error);
    },
  );

  register(
    "camera_set",
    {
      description:
        "Places or moves one of YOUR OWN cameras, by name, for checking your work. It is private to you and never moves the user's view. Aim it like set_view: azimuth (degrees counter-clockwise from east: 0 from the east, 90 from the north, 180 from the west, 270 from the south), elevation (5 to 89 degrees above the horizon), distance (millimetres from the target), target (a point, millimetres) or frame (element or Rhino object ids to bring into view). What you leave out stays; a new camera with nothing given frames the whole model. At most 8 cameras; they end with your task. Take a picture with camera_capture.",
      inputSchema: z.object({
        name: z.string().min(1).max(32).describe("A short name, e.g. south-east"),
        azimuth: z.number().optional().describe("Degrees counter-clockwise from east (+X)"),
        elevation: z.number().optional().describe("Degrees above the horizon, 5 to 89"),
        distance: z.number().optional().describe("Millimetres from the target"),
        target: z
          .tuple([z.number(), z.number(), z.number()])
          .optional()
          .describe("A point to look at, millimetres"),
        frame: z.array(z.string()).optional().describe("Element or Rhino object ids to bring into view"),
      }),
    },
    async ({ name, ...aim }) => {
      if (!deps.eyes) return failure("Cameras are not available in this session.");
      const given = Object.values(aim).some((v) => v !== undefined);
      const parsed = given ? ViewRequest.safeParse(aim) : { success: true as const, data: {} as ViewRequest };
      if (!parsed.success) return failure(parsed.error.issues.map((i) => i.message).join("; "));
      const placed = deps.eyes.place(callerName(caller), name, parsed.data);
      return placed.ok ? text({ status: "placed", camera: placed.camera }) : failure(placed.error);
    },
  );

  register(
    "camera_list",
    {
      description:
        "Lists your own cameras (name, direction, distance, target). Other agents' cameras are not shown.",
      inputSchema: z.object({}),
    },
    async () => text({ cameras: deps.eyes?.list(callerName(caller)) ?? [] }),
  );

  register(
    "camera_delete",
    {
      description: 'Deletes one of your cameras by name, or all of them with the name "all".',
      inputSchema: z.object({ name: z.string().min(1).max(32) }),
    },
    async ({ name }) => {
      if (!deps.eyes) return failure("Cameras are not available in this session.");
      const agent = callerName(caller);
      if (name === "all") {
        deps.eyes.clear(agent);
        return text({ status: "deleted", name });
      }
      return deps.eyes.remove(agent, name)
        ? text({ status: "deleted", name })
        : failure(`You have no camera named "${name}".`);
    },
  );

  register(
    "camera_capture",
    {
      description:
        "Takes pictures from your own cameras, off-screen: the user's view, camera, selection and hover are never involved, and the pictures show the model as it is (owners' tints included) without the user's marks. Name cameras you placed, or give a preset that makes cameras for you: iso (four corners), top, front, left, or orbit-sheet (eight views around the model), framed on the whole model or on the elements in frame. With neither, all your cameras are used. Each picture is labelled with where it looks from. Use it after you change the model, to check what you made from more than one side. size is the longest side in pixels (at most 1280). The user's section cut and selection are left out unless you ask (section, selection).",
      inputSchema: z.object({
        cameras: z.array(z.string()).max(MAX_AGENT_CAMERAS).optional().describe("Names of your cameras"),
        preset: z.enum(PRESETS).optional(),
        frame: z
          .array(z.string())
          .max(200)
          .optional()
          .describe("With a preset: frame these ids instead of the whole model"),
        size: z.number().int().min(64).max(1280).optional(),
        section: z.boolean().optional().describe("Show the user's section cut"),
        selection: z.boolean().optional().describe("Show the user's selection and hover"),
      }),
    },
    async ({ cameras, preset, frame, size, section, selection }) => {
      const eyes = deps.eyes;
      if (!eyes) return failure("Cameras are not available in this session.");
      const agent = callerName(caller);
      if (cameras && preset) return failure("Give cameras or a preset, not both.");
      let chosen: AgentCamera[];
      if (preset) {
        const box = eyes.box(frame);
        if (frame && !box)
          return failure("None of those ids is an element or Rhino object, so there is nothing to frame.");
        chosen = presetCameras(preset, box);
      } else if (cameras) {
        const missing = cameras.filter((n) => !eyes.get(agent, n));
        if (missing.length > 0)
          return failure(
            `You have no camera named ${missing.map((n) => `"${n}"`).join(", ")}. Place one with camera_set, or use a preset.`,
          );
        chosen = cameras.map((n) => eyes.get(agent, n) as AgentCamera);
      } else {
        chosen = eyes.list(agent);
        if (chosen.length === 0)
          return failure("You have no cameras yet. Place one with camera_set, or use a preset such as iso.");
      }
      const out = await eyes.capture(agent, chosen, {
        ...(size ? { size } : {}),
        ...(section !== undefined ? { section } : {}),
        ...(selection !== undefined ? { selection } : {}),
      });
      if (!out.ok) return failure(out.error);
      return {
        content: out.shots.flatMap((shot) => [
          { type: "text" as const, text: describeCamera(shot.camera) },
          { type: "image" as const, data: shot.png, mimeType: "image/png" },
        ]),
      };
    },
  );

  register(
    "sun_study",
    {
      description:
        "Works out where the sun is at a date, time and place (NOAA solar position) and returns its altitude and azimuth with a picture of the model in that light, taken from your camera named 'sun' if you placed one, else from the south-east. North is +Y. The user's own light is not changed.",
      inputSchema: z.object({
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .describe("Local date, YYYY-MM-DD"),
        time: z
          .string()
          .regex(/^\d{1,2}:\d{2}$/)
          .describe("Local clock time, HH:MM"),
        latitude: z.number().min(-90).max(90).describe("Degrees, north positive"),
        longitude: z.number().min(-180).max(180).describe("Degrees, east positive"),
        utcOffsetHours: z
          .number()
          .min(-14)
          .max(14)
          .optional()
          .describe("Local time minus UTC, hours (default: from the longitude, without daylight saving)"),
      }),
    },
    async ({ date, time, latitude, longitude, utcOffsetHours }) => {
      const [y, m, d] = date.split("-").map(Number) as [number, number, number];
      const [hh, mm] = time.split(":").map(Number) as [number, number];
      const offset = utcOffsetHours ?? Math.round(longitude / 15);
      const instant = new Date(Date.UTC(y, m - 1, d, hh, mm) - offset * 3_600_000);
      if (Number.isNaN(instant.getTime())) return failure(`${date} ${time} is not a date and time.`);
      const sun = sunPosition(instant, latitude, longitude);
      const altitude = Math.round(sun.altitude * 10) / 10;
      const azimuth = Math.round(sun.azimuth * 10) / 10;
      const place = `${Math.abs(latitude)} ${latitude >= 0 ? "N" : "S"} ${Math.abs(longitude)} ${longitude >= 0 ? "E" : "W"}`;
      const label = `${date} ${time}, ${place}`;
      const result = {
        altitude,
        azimuth,
        from: compass(sun.azimuth),
        aboveHorizon: altitude > 0,
        utc: instant.toISOString(),
      };
      const light = {
        altitude: Math.max(-90, Math.min(90, sun.altitude)),
        azimuth: sun.azimuth,
        label,
      };
      // With cameras of their own, the pictures carry the sun for themselves and the user's light is left alone.
      if (deps.eyes) {
        const agent = callerName(caller);
        const camera = deps.eyes.get(agent, "sun") ?? presetCameras("iso", deps.eyes.box())[3];
        const shot = camera ? await deps.eyes.capture(agent, [camera], { sun: light }) : null;
        if (!shot) return text({ ...result, view: "There is nothing in the model to look at yet." });
        return shot.ok
          ? {
              content: [
                { type: "text" as const, text: JSON.stringify(result, null, 2) },
                { type: "image" as const, data: shot.shots[0]?.png ?? "", mimeType: "image/png" },
              ],
            }
          : text({ ...result, view: shot.error });
      }
      const view = await deps.captureView(light);
      return view.ok
        ? {
            content: [
              { type: "text" as const, text: JSON.stringify(result, null, 2) },
              { type: "image" as const, data: view.png, mimeType: "image/png" },
            ],
          }
        : text({ ...result, view: view.error });
    },
  );

  register(
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
      text(JSON.stringify(await deps.approve(tool_name, input, tool_use_id, caller.agent))),
  );

  const { tools } = caller;
  if (tools) {
    for (const [name, tool] of registered) if (name !== "approve_tool" && !tools.has(name)) tool.remove();
  }
  return server;
}
