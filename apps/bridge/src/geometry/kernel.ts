import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { PythonTools } from "../mcp/scene-tools.ts";

/**
 * OpenCascade for Python, pinned: the recipes in `hai_occ.py` are written and tested against this release, and
 * a newer one may rename the calls they use.
 */
export const KERNEL_PACKAGES = ["cadquery-ocp==8.0.1.1.0"] as const;

/** The geometry tools that need the kernel (and so ask the user once before it is installed). */
export const KERNEL_TOOL_NAMES = [
  "geometry_loft",
  "geometry_sweep",
  "geometry_boolean",
  "geometry_offset",
] as const;

/** How long one recipe may run. */
const RECIPE_TIMEOUT_MS = 120_000;

/** A curve as the recipes take it. */
export interface RecipeCurve {
  points: Array<[number, number, number]>;
  closed: boolean;
}

/** The extrusion of a footprint: what a massing, column, wall or slab is to a boolean. */
export interface RecipeSolid {
  outline: Array<[number, number]>;
  z0: number;
  z1: number;
}

export type Recipe =
  | { recipe: "loft"; sections: RecipeCurve[]; ruled: boolean }
  | { recipe: "sweep"; profile: RecipeCurve; rail: RecipeCurve; smooth: boolean }
  | { recipe: "boolean"; op: "union" | "difference" | "intersection"; a: RecipeSolid[]; b: RecipeSolid[] }
  | { recipe: "offset"; curve: RecipeCurve; distance: number; corners: "sharp" | "round" };

const Answer = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    parts: z
      .array(z.object({ positions: z.array(z.number()), indices: z.array(z.number().int()) }))
      .optional(),
    curves: z
      .array(
        z.object({ points: z.array(z.tuple([z.number(), z.number(), z.number()])), closed: z.boolean() }),
      )
      .optional(),
    volume: z.number().optional(),
    valid: z.boolean().optional(),
  }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type RecipeAnswer = Extract<z.infer<typeof Answer>, { ok: true }>;

export type KernelOutcome = { ok: true; answer: RecipeAnswer } | { ok: false; error: string };

export interface KernelContext {
  agent: string | null;
  signal: AbortSignal;
}

/** What went wrong with a run, in words for the agent: Windows may refuse OpenCascade's library outright. */
function explain(error: string): string {
  if (/Application Control policy|0x800711C7/i.test(error))
    return "Windows blocked OpenCascade's library (an Application Control policy such as Smart App Control refuses unsigned native code on this machine), so the geometry kernel cannot run here. Tell the user; nothing was changed. Do not try to work around it.";
  if (/No module named ['"]?(OCP|hai_occ)/i.test(error))
    return `The geometry kernel is not installed in this project's Python environment (${KERNEL_PACKAGES.join(", ")}). Nothing was changed.`;
  return error;
}

/**
 * OpenCascade's recipes (loft, sweep, boolean, offset), run in the managed Python environment. A call writes its request
 * as JSON beside the project's other Python files, runs a short script that is kept like any other run, and reads the
 * answer back. The script never sees more than the request, so what it can do is what `hai_occ.py` offers.
 */
export class GeometryKernel {
  constructor(
    private readonly python: PythonTools,
    private readonly projectDir: () => string | null,
  ) {}

  async run(recipe: Recipe, title: string, context: KernelContext): Promise<KernelOutcome> {
    const project = this.projectDir();
    if (!project) return { ok: false, error: "Open a project first." };
    const folder = join(project, ".hai", "geometry");
    mkdirSync(folder, { recursive: true });
    const stem = join(folder, `${Date.now()}-${randomUUID().slice(0, 8)}`);
    const request = `${stem}.request.json`;
    const result = `${stem}.result.json`;
    writeFileSync(request, JSON.stringify(recipe));
    try {
      const out = await this.python.run(
        {
          code: `import hai_occ\nresult = hai_occ.run(${JSON.stringify(request)}, ${JSON.stringify(result)})\n`,
          title,
          packages: [...KERNEL_PACKAGES],
          timeoutMs: RECIPE_TIMEOUT_MS,
          agent: context.agent,
        },
        context.signal,
      );
      if (!out.ok) return { ok: false, error: explain(out.error ?? out.stdout) };
      const parsed = Answer.safeParse(JSON.parse(readFileSync(result, "utf8")));
      if (!parsed.success)
        return { ok: false, error: "The geometry kernel answered with something unreadable." };
      return parsed.data.ok ? { ok: true, answer: parsed.data } : { ok: false, error: parsed.data.error };
    } catch (error) {
      return { ok: false, error: explain(error instanceof Error ? error.message : String(error)) };
    } finally {
      rmSync(result, { force: true });
    }
  }
}
