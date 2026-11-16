import {
  HOST_DESCRIBE_MAX,
  type HostApiEntry,
  type HostApp,
  type HostCapabilities,
  type HostComponent,
  type HostId,
  type HostLanguage,
  VIEW_MODES,
  type ViewMode,
} from "@hai/protocol";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { failure, text } from "./tool-results.ts";
import { stopSignal } from "./tool-util.ts";

/** One host as the agent's tools see it: in use (connected and switched on), with what it can do now. */
export interface HostToolHost {
  id: HostId;
  label: string;
  strengths: string;
  language: HostLanguage;
  runHint: string;
  app: HostApp | null;
  capabilities: HostCapabilities | null;
  /** Why code cannot run here now, or null when it can. */
  unavailable: string | null;
  /** Whether `host_read` has a script for this host. */
  readable: boolean;
}

export interface HostRunAnswer {
  ok: boolean;
  stdout: string;
  result?: string;
  error?: string;
  durationMs: number;
  /** The run as a readable script in the project (`.hai/scripts`). */
  script: string | null;
  /** What the run added, changed and deleted, counted. */
  changed?: { added: number; changed: number; deleted: number };
  /** What the run did outside the agent's claim, found after it ran. */
  outsideClaim?: string;
}

/** What the host tools do (see hosts/registry.ts and server.ts). */
export interface HostTools {
  /** The hosts in use, in a fixed order. */
  hosts(): HostToolHost[];
  run(
    input: { host: HostId; code: string; title: string; timeoutMs: number; agent: string | null },
    signal: AbortSignal,
  ): Promise<HostRunAnswer>;
  /** Reads the open document (units, layers, counts, selection, active view) as JSON text. */
  document(
    host: HostId,
    signal: AbortSignal,
  ): Promise<{ ok: true; json: string } | { ok: false; error: string }>;
  capture(
    host: HostId,
    view: ViewMode | undefined,
    width: number,
    height: number,
  ): Promise<{ ok: true; png: string; durationMs: number } | { ok: false; error: string }>;
  placeImage(input: {
    host: HostId;
    path: string;
    origin: [number, number, number];
    normal: [number, number, number];
    widthMm: number;
    heightMm?: number;
    agent: string | null;
    title: string;
  }): Promise<{ ok: true; objectId?: string } | { ok: false; error: string }>;
  api(
    host: HostId,
    query: string,
  ): Promise<{ entries: HostApiEntry[]; truncated: boolean; partial: boolean }>;
  describe(host: HostId, ids: string[]): Promise<HostComponent[]>;
}

export interface HostToolDeps {
  hosts: HostTools;
  requestSignal?: AbortSignal | undefined;
}

const Point3 = z.tuple([z.number(), z.number(), z.number()]);

/** The hosts in use, one line each: what it is, what it does best, and whether code runs in it now. */
function hostLines(hosts: HostToolHost[]): string {
  return hosts
    .map(
      (h) =>
        `- ${h.id} (${h.app ? `${h.label} ${h.app.version}` : h.label}): best for ${h.strengths}.${h.unavailable ? ` Code cannot run now: ${h.unavailable}` : ""}`,
    )
    .join("\n");
}

function runDescription(hosts: HostToolHost[]): string {
  const languages = hosts.map((h) => `- ${h.id}: ${h.runHint}`).join("\n");
  return `Runs a script in a host application the user has open, against its open document. Hosts in use:
${hostLines(hosts)}

What a script has in each host:
${languages}

The user sees the whole script, the host and every package first, and nothing runs until they allow it. The run is ONE undo step in the host, labelled with your name and the title, and returns what it printed, the value of a variable named \`result\` (if you set one), how many objects it added, changed and deleted, and any error with the end of its traceback. A run blocks the host's window while it works, so keep it short and split big jobs; it is ended after timeoutSeconds (default 60, at most 600) or when the user presses Stop.

The user sees every host's model in HAI's viewer, drawn from what the host has: objects you add, change or delete appear there within a fraction of a second, so do not ask them to look at the host's window. Read units and layers with host_read first, check your work with host_capture, and look up a method you are unsure of with host_api. Curves, points and annotations are not drawn in HAI's viewer, so prefer surfaces and solids when the user needs to see something.`;
}

/**
 * The host tools: one set for every host the user has in use, each taking the host as an argument. Registered only
 * while at least one host is in use; the agent's session restarts when that changes, so the list follows.
 */
export function registerHostTools(
  register: McpServer["registerTool"],
  deps: HostToolDeps,
  agent: string | null,
): void {
  const all = deps.hosts.hosts();
  if (all.length === 0) return;
  const ids = all.map((h) => h.id) as [HostId, ...HostId[]];
  const HostArg = z.enum(ids).describe(`The host: ${ids.join(", ")}`);
  const find = (id: HostId) => deps.hosts.hosts().find((h) => h.id === id);
  const notInUse = (id: HostId) =>
    failure(
      `${id} is not in use now. The hosts in use are: ${
        deps.hosts
          .hosts()
          .map((h) => h.id)
          .join(", ") || "none"
      }.`,
    );

  register(
    "host_list",
    {
      description:
        "Lists the design applications (hosts) the user has connected and switched on, what each does best, and whether code can run in it now. Call it before you plan work across hosts.",
      inputSchema: z.object({}),
    },
    async () =>
      text({
        hosts: deps.hosts.hosts().map((h) => ({
          host: h.id,
          app: h.app,
          bestFor: h.strengths,
          language: h.language,
          canRun: h.unavailable === null,
          ...(h.unavailable ? { why: h.unavailable } : {}),
          canCapture: h.capabilities?.capture ?? false,
          canPlaceImages: h.capabilities?.placeImage ?? false,
          canLookUpApi: h.capabilities?.apiLookup ?? false,
          canDescribe: h.capabilities?.describe ?? false,
        })),
      }),
  );

  register(
    "host_run",
    {
      description: runDescription(all),
      inputSchema: z.object({
        host: HostArg,
        code: z.string().min(1).max(200_000).describe("The script, in the host's language"),
        title: z.string().trim().min(1).max(80).describe('A short title, e.g. "Loft the canopy"'),
        timeoutSeconds: z.number().int().min(1).max(600).optional().describe("Default 60"),
      }),
    },
    async ({ host, code, title, timeoutSeconds }, ctx) => {
      const target = find(host);
      if (!target) return notInUse(host);
      if (target.unavailable) return failure(target.unavailable);
      const out = await deps.hosts.run(
        { host, code, title, timeoutMs: (timeoutSeconds ?? 60) * 1000, agent },
        stopSignal(ctx.mcpReq.signal, deps.requestSignal),
      );
      const body = {
        ok: out.ok,
        host,
        output: out.stdout,
        ...(out.result !== undefined ? { result: out.result } : {}),
        ...(out.error ? { error: out.error } : {}),
        durationMs: out.durationMs,
        ...(out.changed ? { changed: out.changed } : {}),
        ...(out.script ? { script: out.script } : {}),
        ...(out.outsideClaim ? { outsideYourClaim: out.outsideClaim } : {}),
      };
      return out.ok ? text(body) : failure(JSON.stringify(body, null, 2));
    },
  );

  register(
    "host_read",
    {
      description:
        "Reads a host's open document without running anything you wrote: its units, its layers or collections (path, colour, visibility, object counts), how many objects of each type it has, which are selected, and the active view. Call it before you write a script so you use the right units and layers.",
      inputSchema: z.object({ host: HostArg }),
    },
    async ({ host }, ctx) => {
      const target = find(host);
      if (!target) return notInUse(host);
      if (!target.readable)
        return failure(`${target.label} cannot be read this way yet: use host_describe or host_run.`);
      const out = await deps.hosts.document(host, stopSignal(ctx.mcpReq.signal, deps.requestSignal));
      return out.ok ? text(out.json) : failure(out.error);
    },
  );

  register(
    "host_capture",
    {
      description:
        "A picture of a host's own viewport, as the host draws it: its active view, or a named view. Use it to check what a run made, and compare it with your own cameras (camera_capture), which show HAI's mirror of the same model.",
      inputSchema: z.object({
        host: HostArg,
        view: z.enum(VIEW_MODES).optional().describe("A named view; leave out for the host's active view"),
        width: z.number().int().min(64).max(1280).optional().describe("Default 1024"),
        height: z.number().int().min(64).max(1280).optional().describe("Default 640"),
      }),
    },
    async ({ host, view, width, height }) => {
      const target = find(host);
      if (!target) return notInUse(host);
      const out = await deps.hosts.capture(host, view, width ?? 1024, height ?? 640);
      if (!out.ok) return failure(out.error);
      return {
        content: [
          {
            type: "text" as const,
            text: `${target.label}, ${view ?? "active view"}, captured in ${Math.round(out.durationMs)} ms`,
          },
          { type: "image" as const, data: out.png, mimeType: "image/png" },
        ],
      };
    },
  );

  register(
    "host_place_image",
    {
      description:
        "Puts an image file from the project into a host as a picture on a plane (a site photo, a reference, a sketch), embedded in the host's document, as ONE undo step. The picture is centred on origin, faces along normal, and is widthMm wide (its height follows the image unless heightMm is given). Millimetres, Z up.",
      inputSchema: z.object({
        host: HostArg,
        path: z.string().min(1).max(520).describe('A path inside the project, e.g. ".hai/images/site.jpg"'),
        origin: Point3.describe("The picture's centre, mm"),
        normal: Point3.describe("The direction the picture faces, e.g. [0, -1, 0] to face south"),
        widthMm: z.number().positive(),
        heightMm: z.number().positive().optional(),
        title: z.string().trim().min(1).max(80).describe('A short title, e.g. "Site photo"'),
      }),
    },
    async ({ host, path, origin, normal, widthMm, heightMm, title }) => {
      if (!find(host)) return notInUse(host);
      if (normal.every((v) => v === 0)) return failure("normal must not be zero.");
      const out = await deps.hosts.placeImage({
        host,
        path,
        origin,
        normal,
        widthMm,
        ...(heightMm ? { heightMm } : {}),
        agent,
        title,
      });
      return out.ok
        ? text({ ok: true, host, ...(out.objectId ? { objectId: out.objectId } : {}) })
        : failure(out.error);
    },
  );

  register(
    "host_api",
    {
      description:
        'Looks up a host\'s scripting API inside the running host, so the answer matches the version the user has: types and members whose names match the query, with their signatures and summaries (at most 50). Query a name or a dotted path, e.g. "Brep.CreateFromLoft" or "loft".',
      inputSchema: z.object({ host: HostArg, query: z.string().trim().min(1).max(200) }),
    },
    async ({ host, query }) => {
      const target = find(host);
      if (!target) return notInUse(host);
      try {
        const out = await deps.hosts.api(host, query);
        return text({
          host,
          entries: out.entries,
          ...(out.truncated ? { truncated: true } : {}),
          ...(out.partial
            ? { note: "The index is still being built: ask again in a moment for the rest." }
            : {}),
        });
      } catch (error) {
        return failure((error as Error).message);
      }
    },
  );

  register(
    "host_describe",
    {
      description: `Describes objects of a host by id, as the host knows them: name, type, layer or category, bounds, area, volume or length, material, and the object's own properties (Rhino user strings, Blender custom properties, Revit parameters). At most ${HOST_DESCRIBE_MAX}. A request about the user's selection already carries this.`,
      inputSchema: z.object({ host: HostArg, ids: z.array(z.string()).min(1).max(HOST_DESCRIBE_MAX) }),
    },
    async ({ host, ids }) => {
      if (!find(host)) return notInUse(host);
      try {
        return text({ host, components: await deps.hosts.describe(host, ids) });
      } catch (error) {
        return failure((error as Error).message);
      }
    },
  );
}
