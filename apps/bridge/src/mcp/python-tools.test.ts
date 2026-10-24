import { mkdtempSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import { sharedPythonEnv } from "../../test/python-env.ts";
import { connectFakeRhino } from "../../test/rhino-client.ts";
import { connectClient } from "../../test/ws-client.ts";
import type { PythonEnv } from "../python/python-env.ts";
import { type Bridge, createBridge } from "../server.ts";
import type { Caller } from "./agent-tokens.ts";
import { pythonRunDescription, WORKBENCH_CAN, WORKBENCH_CANNOT } from "./python-api.ts";
import { RHINO_DOCUMENT_SCRIPT, requirementPackages } from "./rhino-tools.ts";

const ORIGIN = "http://localhost:5173";
const TOKEN = "python-tools-token-0123456789";
let bridge: Bridge | null = null;
const sockets: WebSocket[] = [];
const clients: Client[] = [];
// One real environment for the file (installed once and kept); null where no Python 3.10+ is installed.
const env: PythonEnv | null = await sharedPythonEnv().catch(() => null);

afterEach(async () => {
  for (const c of clients.splice(0)) await c.close();
  for (const ws of sockets.splice(0)) ws.close();
  await bridge?.stop();
  bridge = null;
});

async function start(): Promise<AddressInfo> {
  bridge = createBridge({
    host: "127.0.0.1",
    port: 0,
    allowedOrigins: [ORIGIN],
    version: "t",
    token: TOKEN,
    mirrorDir: join(mkdtempSync(join(tmpdir(), "hai-pytools-mirror-")), "m"),
    scene: { projectDir: join(mkdtempSync(join(tmpdir(), "hai-pytools-")), "project"), saveDelayMs: 50 },
    ...(env ? { pythonEnv: env } : {}),
  });
  return bridge.start();
}

async function mcp(address: AddressInfo, caller: Caller = { agent: "architect", tools: null }) {
  if (!bridge) throw new Error("no bridge");
  const token = bridge.agentTokens.issue(caller);
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  clients.push(client);
  return client;
}

const textOf = (result: { content?: unknown }) =>
  (result.content as Array<{ text?: string }> | undefined)?.[0]?.text ?? "";
const json = (result: { content?: unknown }) => JSON.parse(textOf(result));

describe("the capability description", () => {
  it("names every operation it promises and every one it denies", () => {
    const description = pythonRunDescription();
    for (const name of [...WORKBENCH_CAN, ...WORKBENCH_CANNOT]) expect(description).toContain(name);
    expect(description).toMatch(/CANNOT loft, sweep, boolean/);
    expect(description).toContain("hai_3dm.save");
    expect(description).toMatch(/rhino_run_python/);
  });

  it.skipIf(!process.env.HAI_CHECK_RHINO3DM && false)(
    "matches the installed rhino3dm: what is promised exists, what is denied does not",
    async () => {
      if (!env) return;
      const { PythonWorkbench } = await import("../python/python-run.ts");
      const { HELPER_DIR } = await import("../../test/python-env.ts");
      const project = mkdtempSync(join(tmpdir(), "hai-drift-"));
      const bench = new PythonWorkbench({ env, projectDir: () => project, helperDir: HELPER_DIR });
      const present = (names: readonly string[]) =>
        `[${names.map((n) => `hasattr(getattr(r, "${n.split(".")[0]}"), "${n.split(".")[1]}")`).join(", ")}]`;
      const out = await bench.run({
        title: "Drift",
        packages: [],
        agent: null,
        code: `import rhino3dm as r\nresult = {"can": ${present(WORKBENCH_CAN)}, "cannot": ${present(WORKBENCH_CANNOT)}}`,
      });
      expect(out.ok, out.error).toBe(true);
      const found = JSON.parse(out.result ?? "{}") as { can: boolean[]; cannot: boolean[] };
      expect(WORKBENCH_CAN.filter((_, i) => !found.can[i])).toEqual([]);
      expect(WORKBENCH_CANNOT.filter((_, i) => found.cannot[i])).toEqual([]);
    },
    120_000,
  );
});

describe("python_run through the MCP endpoint", () => {
  it.skipIf(!env)(
    "a script runs and answers; the run is kept and the answer names it",
    async () => {
      if (!env) return;
      const address = await start();
      const agent = await mcp(address);
      const result = await agent.callTool({
        name: "python_run",
        arguments: { code: "print('hi')\nresult = {'sum': 1 + 2}", title: "Add up" },
      });
      expect(result.isError).toBeFalsy();
      const body = json(result);
      expect(body).toMatchObject({ ok: true, output: "hi\n", result: '{"sum": 3}' });
      expect(body.script).toMatch(/^\.hai\/scripts\/.*-add-up\.py$/);
      expect(readFileSync(join(bridge?.scene.projectDir ?? "", body.script), "utf8")).toContain(
        "# outcome: ok",
      );
    },
    120_000,
  );

  it.skipIf(!env)(
    "an error is returned to the agent as a failed result with the traceback, not thrown",
    async () => {
      if (!env) return;
      const address = await start();
      const agent = await mcp(address);
      const result = await agent.callTool({
        name: "python_run",
        arguments: { code: "1/0", title: "Divide" },
      });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatch(/ZeroDivisionError/);
    },
    120_000,
  );

  it.skipIf(!env)(
    "a written .3dm is reported with the next step",
    async () => {
      if (!env) return;
      const address = await start();
      const page = await connectClient(address, { token: TOKEN, origin: ORIGIN, track: sockets });
      const agent = await mcp(address);
      const result = await agent.callTool({
        name: "python_run",
        arguments: {
          title: "Box",
          code: [
            "import rhino3dm as r, hai_3dm",
            "model = r.File3dm()",
            "hai_3dm.add(model, r.Brep.CreateFromBox(r.Box(r.BoundingBox(r.Point3d(0,0,0), r.Point3d(1000,1000,1000)))), 'Box', 'Test')",
            "hai_3dm.save(model, 'box.3dm')",
          ].join("\n"),
        },
      });
      const body = json(result);
      expect(body.filesWritten).toEqual(["box.3dm"]);
      expect(body.next).toMatch(/import/i);
      // The pages are told, so the HUD can offer Import into viewer and Open in Rhino.
      const told = await page.waitFor("python.written");
      expect(told.payload.files.map((f) => f.path)).toEqual(["box.3dm"]);
      expect(told.payload.script).toMatch(/^\.hai\/scripts\/.*-box\.py$/);
      expect(told.payload.agent).toBe("architect");
      // The HAI scene is untouched: the tool only wrote a file.
      expect(Object.keys(bridge?.scene.scene.doc.elements ?? {})).not.toContain("box");
    },
    120_000,
  );

  it.skipIf(!env)(
    "a package that is really an option is refused before anything runs",
    async () => {
      if (!env) return;
      const address = await start();
      const agent = await mcp(address);
      const result = await agent.callTool({
        name: "python_run",
        arguments: { code: "result = 1", title: "Bad", packages: ["--index-url=https://evil.example"] },
      });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatch(/not a package name/);
    },
    120_000,
  );

  it.skipIf(!env)(
    "stop: abandoning the call ends the script, and the kept script says stopped",
    async () => {
      if (!env) return;
      const address = await start();
      const agent = await mcp(address);
      const controller = new AbortController();
      const call = agent
        .callTool(
          {
            name: "python_run",
            arguments: { code: "import time\ntime.sleep(60)", title: "Slow", timeoutSeconds: 120 },
          },
          { signal: controller.signal },
        )
        .catch((error: Error) => error);
      await new Promise((r) => setTimeout(r, 2500));
      controller.abort();
      await call;
      const scripts = join(bridge?.scene.projectDir ?? "", ".hai", "scripts");
      const { readdirSync } = await import("node:fs");
      await expect
        .poll(
          () =>
            readdirSync(scripts)
              .filter((f) => f.endsWith("-slow.py"))
              .map((f) => readFileSync(join(scripts, f), "utf8"))
              .join(""),
          { timeout: 5000 },
        )
        .toContain("# outcome: stopped");
    },
    120_000,
  );

  it("the agents that should not run Python are not offered it", async () => {
    const address = await start();
    const reviewer = await mcp(address, { agent: "reviewer", tools: new Set(["get_elements"]) });
    const names = (await reviewer.listTools()).tools.map((t) => t.name);
    expect(names).not.toContain("python_run");
    expect(names).not.toContain("rhino_run_python");
  });
});

describe("Rhino tools through the MCP endpoint", () => {
  const rhinoTools = new Set(["python_run", "rhino_run_python", "rhino_get_document", "get_elements"]);

  it("with Rhino connected the agent has the Rhino tools, and without it (or in Python only) it does not", async () => {
    const address = await start();
    const names = async () => {
      const agent = await mcp(address, { agent: "architect", tools: rhinoTools });
      return (await agent.listTools()).tools.map((t) => t.name);
    };
    expect(await names()).not.toContain("rhino_run_python");
    const rhino = await connectFakeRhino(address, { token: TOKEN, track: sockets });
    expect(await names()).toEqual(expect.arrayContaining(["rhino_run_python", "rhino_get_document"]));
    const page = await connectClient(address, { token: TOKEN, origin: ORIGIN, track: sockets });
    page.send("settings.set", { modelling: "python" });
    await page.waitFor("rhino.state", (m) => m.payload.mode === "python");
    expect(await names()).not.toContain("rhino_run_python");
    rhino.ws.close();
  });

  it("a run goes to Rhino, the answer comes back, and the run is kept as a script that says it ran in Rhino", async () => {
    const address = await start();
    const rhino = await connectFakeRhino(address, { token: TOKEN, track: sockets });
    const agent = await mcp(address, { agent: "architect", tools: rhinoTools });
    const call = agent.callTool({
      name: "rhino_run_python",
      arguments: { code: "# r: ladybug-core\nresult = 'lofted'", title: "Loft the canopy" },
    });
    const asked = await rhino.waitFor("rhino.python.run");
    expect(asked.payload.code).toContain("lofted");
    rhino.send("rhino.python.result", {
      id: asked.payload.id,
      ok: true,
      stdout: "done\n",
      result: "lofted",
      durationMs: 40,
    });
    const body = json(await call);
    expect(body).toMatchObject({ ok: true, output: "done\n", result: "lofted" });
    const kept = readFileSync(join(bridge?.scene.projectDir ?? "", body.script), "utf8");
    expect(kept).toContain("in Rhino");
    expect(kept).toContain("# packages: ladybug-core");
    expect(kept).toContain("# result: lofted");
  }, 30_000);

  it("a Python error in Rhino comes back as a failed result the agent can fix", async () => {
    const address = await start();
    const rhino = await connectFakeRhino(address, { token: TOKEN, track: sockets });
    const agent = await mcp(address, { agent: "architect", tools: rhinoTools });
    const call = agent.callTool({ name: "rhino_run_python", arguments: { code: "boom()", title: "Boom" } });
    const asked = await rhino.waitFor("rhino.python.run");
    rhino.send("rhino.python.result", {
      id: asked.payload.id,
      ok: false,
      stdout: "",
      error: "NameError: name 'boom' is not defined",
      durationMs: 3,
    });
    const result = await call;
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("NameError");
  }, 30_000);

  it("a requirement line that is not a package is refused before Rhino is asked", async () => {
    const address = await start();
    const rhino = await connectFakeRhino(address, { token: TOKEN, track: sockets });
    const agent = await mcp(address, { agent: "architect", tools: rhinoTools });
    const result = await agent.callTool({
      name: "rhino_run_python",
      arguments: { code: "# r: --index-url=https://evil.example\nresult = 1", title: "Bad" },
    });
    expect(result.isError).toBe(true);
    expect(rhino.received.some((m) => m.type === "rhino.python.run")).toBe(false);
  });

  it("read the document: the bridge runs its own read-only script and returns what Rhino said", async () => {
    const address = await start();
    const rhino = await connectFakeRhino(address, { token: TOKEN, track: sockets });
    const agent = await mcp(address, { agent: "reviewer", tools: new Set(["rhino_get_document"]) });
    const call = agent.callTool({ name: "rhino_get_document", arguments: {} });
    const asked = await rhino.waitFor("rhino.python.run");
    expect(asked.payload.code).toBe(RHINO_DOCUMENT_SCRIPT);
    expect(asked.payload.code).not.toMatch(/\.(Add|Delete|Select|Transform|Rotate|Move)\w*\(/); // it only reads
    rhino.send("rhino.python.result", {
      id: asked.payload.id,
      ok: true,
      stdout: "",
      result: JSON.stringify({
        name: "tower.3dm",
        units: "Millimeters",
        layers: [],
        objectCounts: {},
        selected: [],
      }),
      durationMs: 9,
    });
    expect(json(await call)).toMatchObject({ name: "tower.3dm", units: "Millimeters" });
  }, 30_000);

  it("Python not available in Rhino: the Rhino tools are not offered (the run would fail), and the reason is shown to pages", async () => {
    const address = await start();
    const page = await connectClient(address, { token: TOKEN, origin: ORIGIN, track: sockets });
    await connectFakeRhino(address, {
      token: TOKEN,
      python: { state: "unavailable", reason: "Python 3 is not installed in Rhino" },
      track: sockets,
    });
    const state = await page.waitFor("rhino.state", (m) => m.payload.python?.state === "unavailable");
    expect(state.payload.python).toEqual({
      state: "unavailable",
      reason: "Python 3 is not installed in Rhino",
    });
    const agent = await mcp(address, { agent: "architect", tools: rhinoTools });
    const run = await agent.callTool({ name: "rhino_run_python", arguments: { code: "1", title: "T" } });
    expect(run.isError).toBe(true);
    expect(textOf(run)).toMatch(/Python is not available in Rhino: Python 3 is not installed in Rhino/);
  });
});

describe("requirement lines", () => {
  it("reads packages from '# r:' lines, once each, and reports what is not a package", () => {
    expect(
      requirementPackages(
        "# r: ladybug-core, numpy==2.1\nimport x\n  # R: ladybug-core\n# r: --index-url=https://x\nprint()",
      ),
    ).toEqual({ packages: ["ladybug-core", "numpy==2.1"], invalid: ["--index-url=https://x"] });
    expect(requirementPackages("print('# r: not a line')").packages).toEqual([]);
  });
});
