import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bundleBridge } from "../scripts/bundle.ts";

// The bridge as the installed app runs it: one bundled file, with no repository around it, started by plain Node.
describe("the bridge bundle", () => {
  let root: string;
  let workspace: string;
  let child: ChildProcess | null = null;
  let output = "";

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "hai-bundle-"));
    workspace = join(root, "workspace");
    await bundleBridge(join(root, "bridge"));
    child = spawn(process.execPath, [join(root, "bridge", "main.js")], {
      cwd: root, // no pnpm-workspace.yaml above here
      env: {
        ...process.env,
        HAI_WORKSPACE: workspace,
        HAI_PORT: "0",
        HAI_SAMPLE_SCENE: join(root, "bridge", "samples", "mixed-use-block.hai.json"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (d) => {
      output += d;
    });
    child.stderr?.on("data", (d) => {
      output += d;
    });
  }, 30_000);

  afterAll(() => {
    child?.kill();
    // Windows keeps the folder locked until the child is gone; the temp folder is cleaned by the system anyway.
    setTimeout(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }), 500).unref();
  });

  async function session(): Promise<{ port: number; token: string }> {
    const file = join(workspace, ".hai", "session.json");
    for (let i = 0; i < 150; i++) {
      if (existsSync(file)) {
        try {
          return JSON.parse(readFileSync(file, "utf8"));
        } catch {
          // being written
        }
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`The bridge bundle did not start:\n${output}`);
  }

  it("starts on a free loopback port and answers /health", async () => {
    const { port } = await session();
    expect(port).toBeGreaterThan(0);
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  }, 20_000);

  it("seeds the sample project from the file beside the bundle", async () => {
    await session();
    const scene = join(workspace, ".hai", "projects", "sample", "scene.hai.json");
    expect(existsSync(scene)).toBe(true);
    expect(JSON.parse(readFileSync(scene, "utf8")).units).toBe("mm");
  }, 20_000);
});
