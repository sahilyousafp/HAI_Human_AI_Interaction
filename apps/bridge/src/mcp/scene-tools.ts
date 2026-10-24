import { randomUUID } from "node:crypto";
import {
  type Element,
  PanelDocument,
  type RhinoObject,
  type RhinoSelected,
  type SceneDocument,
  type SceneOp,
  type SunSetting,
  type ViewCamera,
  ViewRequest,
} from "@hai/protocol";
import { elementBounds, sunPosition, unionBounds } from "@hai/scene";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { HAI_SERVER } from "../agent/agent-config.ts";
import type { PermissionDecision } from "../agent/approvals.ts";
import type { PanelResult } from "../agent/panels.ts";
import type { Caller } from "./agent-tokens.ts";
import { openPanelDescription } from "./panel-api.ts";
import { pythonRunDescription } from "./python-api.ts";
import { RHINO_DOCUMENT_DESCRIPTION, RHINO_RUN_DESCRIPTION, requirementPackages } from "./rhino-tools.ts";

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
  captureView(sun?: SunSetting): Promise<{ ok: true; png: string } | { ok: false; error: string }>;
  /** The team's task board, for the lead's delegate, team_status and cancel_task tools. */
  team?: TeamTools;
  /** Rhino's mirrored objects and selection while the agent models with Rhino; absent otherwise. */
  rhino?: RhinoContext;
  /** The Python workbench: runs a script in the managed environment. */
  python?: PythonTools;
  /** Python in the open Rhino document; present while the agent models with Rhino. */
  rhinoPython?: RhinoPythonTools;
  /** Aborted when the agent ends the request before it is answered (Stop): long tool calls end their work. */
  requestSignal?: AbortSignal;
  /** Asks the viewers to move the camera. */
  setView(request: ViewRequest): { ok: true } | { ok: false; error: string };
  /** Generated panels; absent while the Generated panels feature is switched off. */
  panels?: PanelTools;
  /** Claude Code's permission prompt: whether a tool call may run (resolves when decided). */
  approve(
    tool: string,
    input: Record<string, unknown>,
    toolUseId: string | undefined,
    agent: string | null,
  ): Promise<PermissionDecision>;
}

/** What `python_run` does (see python/python-run.ts). */
export interface PythonTools {
  run(
    input: { code: string; title: string; packages: string[]; timeoutMs: number; agent: string | null },
    signal: AbortSignal,
  ): Promise<{
    ok: boolean;
    stdout: string;
    result?: string;
    error?: string;
    durationMs: number;
    script: string;
    written: Array<{ path: string; size: number }>;
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
  }>;
  /** Reads the open document (units, layers, counts, selection, active view) as text. */
  document(signal: AbortSignal): Promise<{ ok: true; json: string } | { ok: false; error: string }>;
}

/** What the user context says about Rhino. */
export interface RhinoContext {
  /** The mirrored Rhino object with this id (the one under the pointer), if there is one. */
  object(id: string): RhinoObject | undefined;
  selection(): RhinoSelected[];
}

/** What the panel tools do for one agent (see panels.ts). */
export interface PanelTools {
  offer(purpose: string): Promise<PanelResult<{ answer: "accepted" | "skipped" | "expired" }>>;
  open(document: PanelDocument): Promise<PanelResult>;
  update(patch: Partial<PanelDocument>): Promise<PanelResult>;
  close(): PanelResult;
}

/** What the lead's team tools do (see team.ts). */
export interface TeamTools {
  delegate(task: {
    agent: string;
    title: string;
    instruction: string;
  }): { ok: true; taskId: string; status: string } | { ok: false; error: string };
  status(): unknown;
  cancel(taskId: string): { ok: true; status: string } | { ok: false; error: string };
}

/** Aborted when either the protocol cancels the call or the agent ends the HTTP request. */
const stopSignal = (...signals: Array<AbortSignal | undefined>): AbortSignal =>
  AbortSignal.any(signals.filter((s): s is AbortSignal => s !== undefined));

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
/** The compass point an azimuth is nearest. */
const compass = (azimuth: number) => COMPASS[Math.round(azimuth / 22.5) % 16] as string;

const ELEMENT_SHAPES = `Lengths are millimetres, Z up. Element shapes (id is optional when creating):
- massing: { type: "massing", name, level?, origin: [x, y, z] (minimum corner), size: [width, depth, height] }
- wall: { type: "wall", name, level?, start: [x, y], end: [x, y], height, thickness } (centred on its baseline, rising from its level)
- column: { type: "column", name, level?, position: [x, y], section: [width, depth], height }
- slab: { type: "slab", name, level?, outline: [[x, y], ...] (counter-clockwise), thickness } (extruded down from its level)
- imported: reference geometry from the user's Rhino file: { type: "imported", name, layer?, color?, bounds: { min: [x, y, z], max: [x, y, z] } (before translation), translation: [x, y, z] }. You see its box, never its triangles. Move it by changing translation; delete it as any element; copy it by creating another with the same asset, part and bounds. You cannot change its shape.
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

  register(
    "get_elements",
    {
      description: `Full details of elements: by ids, or filtered by type and level (at most ${MAX_ELEMENTS}). ${ELEMENT_SHAPES}`,
      inputSchema: z.object({
        ids: z.array(z.string()).optional().describe("Element ids"),
        type: z.enum(["massing", "slab", "wall", "column", "imported"]).optional(),
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

  register(
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

  register(
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

  register(
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

  register(
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

  const { team } = deps;
  if (team) {
    register(
      "delegate",
      {
        description:
          "Hands a task to a specialist of the team. Returns at once with the task id; the specialist works on it in its own session, and you are told when it has finished. Give each task a short title and a complete instruction: the specialist does not see your conversation, so include what the user pointed at or selected (element ids) and sizes in millimetres. Quote the user's own words in the instruction, especially anything about how they want to work (for example that they want to tune or try values themselves): the specialist decides from it how to help, and cannot know what you leave out.",
        inputSchema: z.object({
          agent: z.string().describe("The specialist's name, as in your team list"),
          title: z.string().min(1).max(80).describe('A short title, e.g. "Stair core"'),
          instruction: z.string().min(1).max(8000),
        }),
      },
      async (task) => {
        const result = team.delegate(task);
        return result.ok ? text({ taskId: result.taskId, status: result.status }) : failure(result.error);
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
          'Asks the user whether they want a small panel for this task (for example sliders for a clearance and its tolerance). Offer one when the request is about tolerances, ranges or parameters the user will want to feel out, or when they say they want to tune, adjust or try values themselves, and do so before you change the model for them; do not offer for one-off edits. The user answers with a nod, a click or a shake, and this call waits for the answer (at most a minute): "accepted" (now call open_panel), "skipped" (carry on in chat) or "expired". One offer at a time; refused while a panel is open.',
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
        return text({ answer: result.answer, next });
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
          timeoutSeconds: z.number().int().min(1).max(600).optional().describe("Default 60"),
        }),
      },
      async ({ code, title, packages, timeoutSeconds }, ctx) => {
        const out = await python.run(
          {
            code,
            title,
            packages: packages ?? [],
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
        "Moves the user's camera in the 3D view: turn it (azimuth in degrees around the target, counter-clockwise from east: 0 from the east, 90 from the north, 180 from the west, 270 from the south, 225 from the south-west), tilt it (elevation 5 to 89 degrees above the horizon), move it nearer or further (distance in millimetres from the target), look at a point (target, millimetres) or frame elements (their ids, including Rhino objects). Give at least one; what you leave out stays. The view animates there over under a second and gives way at once if the user orbits. It changes nothing in the model. Use it to show the user what you made or to look at it from another side before you change it.",
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
    "sun_study",
    {
      description:
        "Sets the viewer's sun to where it is at a date, time and place (NOAA solar position), so the model casts those shadows, and returns the sun's altitude and azimuth with a picture of the view. North is +Y. The light stays until the user presses Escape or picks another tool.",
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
      const view = await deps.captureView({
        altitude: Math.max(-90, Math.min(90, sun.altitude)),
        azimuth: sun.azimuth,
        label,
      });
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
