import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PythonTools } from "../mcp/scene-tools.ts";
import { GeometryKernel, KERNEL_PACKAGES, type Recipe } from "./kernel.ts";

const project = () => mkdtempSync(join(tmpdir(), "hai-kernel-"));
const context = { agent: "architect", signal: new AbortController().signal };

const offset: Recipe = {
  recipe: "offset",
  curve: {
    points: [
      [0, 0, 0],
      [1000, 0, 0],
      [1000, 1000, 0],
    ],
    closed: false,
  },
  distance: 100,
  corners: "sharp",
};

type RunInput = Parameters<PythonTools["run"]>[0];

/** A Python workbench that writes the answer the script would, or fails the way it is told to. */
function fakePython(behaviour: { answer?: unknown; failure?: string }) {
  const runs: RunInput[] = [];
  const python: PythonTools = {
    run: async (input) => {
      runs.push(input);
      const [request, result] = [...input.code.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(
        (m) => JSON.parse(`"${m[1]}"`) as string,
      );
      expect(existsSync(request as string)).toBe(true);
      if (behaviour.failure)
        return {
          ok: false,
          stdout: "",
          error: behaviour.failure,
          durationMs: 1,
          script: "s.py",
          written: [],
        };
      writeFileSync(result as string, JSON.stringify(behaviour.answer));
      return { ok: true, stdout: "", durationMs: 1, script: "s.py", written: [] };
    },
  };
  return { python, runs };
}

describe("GeometryKernel", () => {
  it("writes the request, runs hai_occ with the pinned package, and reads the answer", async () => {
    const dir = project();
    const curves = [{ points: [[0, -100, 0]], closed: false }];
    const { python, runs } = fakePython({ answer: { ok: true, curves } });
    const outcome = await new GeometryKernel(python, () => dir).run(offset, "Offset", context);
    expect(outcome).toEqual({ ok: true, answer: { ok: true, curves } });
    expect(runs[0]).toMatchObject({ title: "Offset", packages: [...KERNEL_PACKAGES], agent: "architect" });
    expect(runs[0]?.code).toContain("import hai_occ");
    const request = /"([^"]+\.request\.json)"/.exec(runs[0]?.code ?? "")?.[1] ?? "";
    expect(JSON.parse(readFileSync(JSON.parse(`"${request}"`), "utf8"))).toEqual(offset);
  });

  it("removes the answer file, which can be large, and keeps the small request", async () => {
    const dir = project();
    const { python, runs } = fakePython({ answer: { ok: true, curves: [] } });
    await new GeometryKernel(python, () => dir).run(offset, "Offset", context);
    const [request, result] = [...(runs[0]?.code ?? "").matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(
      (m) => JSON.parse(`"${m[1]}"`) as string,
    );
    expect(existsSync(request as string)).toBe(true);
    expect(existsSync(result as string)).toBe(false);
  });

  it("passes on what the recipe says is wrong with the request", async () => {
    const { python } = fakePython({ answer: { ok: false, error: "A loft needs at least 2 sections." } });
    expect(await new GeometryKernel(python, () => project()).run(offset, "Loft", context)).toEqual({
      ok: false,
      error: "A loft needs at least 2 sections.",
    });
  });

  it("refuses an answer it cannot read", async () => {
    const { python } = fakePython({ answer: { ok: true, curves: "no" } });
    const outcome = await new GeometryKernel(python, () => project()).run(offset, "Offset", context);
    expect(outcome).toMatchObject({ ok: false, error: expect.stringContaining("unreadable") });
  });

  it("says plainly when Windows will not load OpenCascade, and not to work round it", async () => {
    const { python } = fakePython({
      failure:
        "ImportError: DLL load failed while importing OCP: An Application Control policy has blocked this file.",
    });
    const outcome = await new GeometryKernel(python, () => project()).run(offset, "Offset", context);
    expect(outcome).toMatchObject({ ok: false, error: expect.stringContaining("Smart App Control") });
    expect(outcome.ok === false && outcome.error).toContain("Do not try to work around it");
  });

  it("says when the kernel is not installed", async () => {
    const { python } = fakePython({ failure: "ModuleNotFoundError: No module named 'OCP'" });
    const outcome = await new GeometryKernel(python, () => project()).run(offset, "Offset", context);
    expect(outcome).toMatchObject({ ok: false, error: expect.stringContaining("is not installed") });
  });

  it("needs an open project", async () => {
    const { python, runs } = fakePython({ answer: { ok: true } });
    expect(await new GeometryKernel(python, () => null).run(offset, "Offset", context)).toEqual({
      ok: false,
      error: "Open a project first.",
    });
    expect(runs).toHaveLength(0);
  });
});
