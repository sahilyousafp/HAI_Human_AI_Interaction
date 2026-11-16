import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseMessage } from "../packages/protocol/src/index.ts";
import { decodeMeshAsset } from "../packages/scene/src/index.ts";

// The Rhino connector (plugins/rhino) is written in C#. These files are the contract between it and the bridge: the C#
// tests write the messages the plugin sends and the mesh asset it makes, and compare them with the files here (set
// HAI_UPDATE_FIXTURES=1 to write them again); this test makes the TypeScript side read the same files with the real
// schemas and the real reader. A change to either language that breaks the other fails one of the two.

const fixtures = join(import.meta.dirname, "..", "plugins", "rhino", "tests", "fixtures");
const named = (prefix) =>
  readdirSync(fixtures)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
    .sort();

const read = (file) => parseMessage(readFileSync(join(fixtures, file), "utf8"));

describe("what the plugin sends", () => {
  const files = named("message-");
  it("has every kind of message the plugin sends", () => {
    expect(files).toEqual([
      "message-api-result.json",
      "message-capture-failed.json",
      "message-captured.json",
      "message-described.json",
      "message-edit-failed.json",
      "message-edited.json",
      "message-hello-run-unavailable.json",
      "message-hello.json",
      "message-image-placed.json",
      "message-objects.json",
      "message-run-error.json",
      "message-run-result-changes.json",
      "message-run-result.json",
      "message-selection.json",
      "message-status.json",
    ]);
  });

  for (const file of files) {
    it(`${file} is accepted by the bridge's schemas`, () => {
      const parsed = read(file);
      expect(parsed.ok, parsed.ok ? "" : JSON.stringify(parsed.error)).toBe(true);
    });
  }

  it("every message but hello names Rhino as its host", () => {
    for (const file of files.filter((f) => !f.startsWith("message-hello"))) {
      const parsed = read(file);
      expect(parsed.ok && parsed.message.payload.host, file).toBe("rhino");
    }
  });

  it("a hello says it is Rhino, its protocol, and what it can do", () => {
    const ok = read("message-hello.json");
    expect(ok.ok && ok.message.type === "hello" && ok.message.payload).toMatchObject({
      client: "rhino",
      protocolVersion: 2,
      app: { name: "Rhino 8" },
      capabilities: {
        languages: ["python"],
        capture: true,
        placeImage: true,
        apiLookup: true,
        describe: true,
      },
    });
    const none = read("message-hello-run-unavailable.json");
    expect(none.ok && none.message.type === "hello" && none.message.payload).toMatchObject({
      run: { state: "unavailable" },
      document: null,
    });
  });

  it("a run's result carries what it added, changed and deleted, with their tags", () => {
    const parsed = read("message-run-result-changes.json");
    expect(parsed.ok && parsed.message.type === "host.result").toBe(true);
    if (!parsed.ok || parsed.message.type !== "host.result") return;
    const { changes } = parsed.message.payload;
    expect(changes?.added[0]).toMatchObject({
      id: "a-1",
      tags: { "hai.owner": "architect", "hai.part": "dome" },
    });
    expect(changes?.changed[0]?.bounds).toBeNull();
    expect(changes?.deleted.map((c) => c.id)).toEqual(["d-1"]);
  });

  it("a batch names an object with no colour and no mesh the way the viewer expects", () => {
    const parsed = read("message-objects.json");
    expect(parsed.ok && parsed.message.type === "host.objects").toBe(true);
    if (!parsed.ok || parsed.message.type !== "host.objects") return;
    const [canopy, bare] = parsed.message.payload.changed;
    expect(canopy).toMatchObject({ layer: "Roof::Canopy", color: "#3c6ec8", triangles: 1152 });
    expect(canopy?.tags).toEqual({ "hai.owner": "architect" });
    expect(bare).toMatchObject({ color: null, asset: null, triangles: 0 });
    expect(parsed.message.payload.sync).toEqual({ done: 2, total: 40 });
    expect(parsed.message.payload.reset).toBe(true);
  });

  it("a description carries quantities, a material and the object's own user strings", () => {
    const parsed = read("message-described.json");
    expect(parsed.ok && parsed.message.type === "host.described").toBe(true);
    if (!parsed.ok || parsed.message.type !== "host.described") return;
    const [canopy, mesh] = parsed.message.payload.components;
    expect(canopy).toMatchObject({
      type: "Closed Brep",
      material: "Timber",
      quantities: { volumeMm3: 3.24e10 },
      properties: { fireRating: "60" },
    });
    expect(mesh).toMatchObject({ quantitiesSkipped: true, material: null, bounds: null });
  });
});

describe("what the bridge sends the plugin", () => {
  const files = named("bridge-");
  it("has the requests the plugin answers", () => {
    expect(files).toEqual([
      "bridge-api.json",
      "bridge-capture-active.json",
      "bridge-capture.json",
      "bridge-describe.json",
      "bridge-edit-delete.json",
      "bridge-edit-move.json",
      "bridge-image-place.json",
      "bridge-open.json",
      "bridge-redo.json",
      "bridge-refused.json",
      "bridge-run-claimed.json",
      "bridge-run.json",
      "bridge-select-clear.json",
      "bridge-select.json",
      "bridge-undo.json",
    ]);
  });

  for (const file of files) {
    it(`${file} is a message the bridge's schemas produce`, () => {
      const parsed = read(file);
      expect(parsed.ok, parsed.ok ? "" : JSON.stringify(parsed.error)).toBe(true);
    });
  }
});

describe("a run request that names its agent and claim", () => {
  it("is read with the language, the agent, the title, the part and the claim", () => {
    const parsed = read("bridge-run-claimed.json");
    expect(parsed.ok && parsed.message.type === "host.run").toBe(true);
    if (!parsed.ok || parsed.message.type !== "host.run") return;
    expect(parsed.message.payload).toMatchObject({
      host: "rhino",
      language: "python",
      agent: "architect",
      title: "Add the dome",
      part: "dome",
      claim: { part: "dome", region: { min: [0, 0], max: [20000, 20000] } },
    });
  });
});

describe("the mesh asset the plugin writes", () => {
  const bytes = new Uint8Array(readFileSync(join(fixtures, "box.haimesh")));

  it("is read by HAI's own reader, with the box's triangles and bounds", () => {
    const decoded = decodeMeshAsset(bytes);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.parts).toHaveLength(1);
    const [part] = decoded.parts;
    expect(part?.positions.length).toBe(8 * 3);
    expect(part?.indices.length).toBe(12 * 3);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < (part?.positions.length ?? 0); i += 3) {
      for (let k = 0; k < 3; k++) {
        const v = part?.positions[i + k] ?? 0;
        min[k] = Math.min(min[k], v);
        max[k] = Math.max(max[k], v);
      }
    }
    expect(min).toEqual([0, 0, 0]);
    expect(max).toEqual([2000, 1000, 3000]);
  });

  it("states the same bounds in its header", () => {
    const headerLength = new DataView(bytes.buffer, bytes.byteOffset).getUint32(8, true);
    const header = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + headerLength)));
    expect(header.parts[0].bounds).toEqual({ min: [0, 0, 0], max: [2000, 1000, 3000] });
    expect((12 + headerLength) % 4).toBe(0);
  });
});

// The wrapper the plugin gives Rhino's ScriptEditor, run by a plain Python with stand-ins for Rhino's two modules. Real
// Rhino runs are in docs/rhino.md; what is checked here is what comes back to the agent.
const python = ["python", "python3"].find((name) => spawnSync(name, ["--version"]).status === 0);

describe.skipIf(!python)("the wrapper around an agent's script", () => {
  const run = (code, timeoutSeconds = 30) => {
    const folder = mkdtempSync(join(tmpdir(), "hai-wrapper-"));
    try {
      const codePath = join(folder, "agent_script.py");
      const resultPath = join(folder, "result.json");
      const wrapperPath = join(folder, "run.py");
      writeFileSync(join(folder, "Rhino.py"), "class RhinoDoc:\n    ActiveDoc = 'the document'\n");
      writeFileSync(join(folder, "scriptcontext.py"), "doc = None\n");
      writeFileSync(codePath, code);
      writeFileSync(
        wrapperPath,
        readFileSync(join(fixtures, "python-wrapper.py"), "utf8")
          .replace('"CODE_PATH"', JSON.stringify(codePath))
          .replace('"RESULT_PATH"', JSON.stringify(resultPath))
          .replace(/, 1\)\n$/, `, ${timeoutSeconds})\n`),
      );
      const ran = spawnSync(python, [wrapperPath], { encoding: "utf8", timeout: 20_000 });
      expect(ran.status, ran.stderr).toBe(0);
      expect(ran.stdout, "nothing of the script reaches Rhino's command window").toBe("");
      return JSON.parse(readFileSync(resultPath, "utf8"));
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  };

  it("captures output and errors printed, and the value of result as text", () => {
    const out = run("import sys\nprint('hi')\nprint('oops', file=sys.stderr)\nresult = {'a': 1}\n");
    expect(out).toEqual({ stdout: "hi\noops\n", result: "{'a': 1}", error: null });
  });

  it("gives the script the document, in both of the ways scripts ask for it", () => {
    const out = run("import scriptcontext\nresult = __rhino_doc__ + ' / ' + scriptcontext.doc\n");
    expect(out.result).toBe("the document / the document");
  });

  it("reports an error from the script's own lines, keeping the output so far", () => {
    const out = run("print('before')\n1 / 0\n");
    expect(out.stdout).toBe("before\n");
    expect(out.error).toContain('File "agent_script.py", line 2');
    expect(out.error).toContain("ZeroDivisionError");
    expect(out.error).not.toContain("_hai_run");
  });

  it("reports a syntax error", () => {
    expect(run("def (\n").error).toContain("SyntaxError");
  });

  it("does not take sys.exit() for a failure, unless it says so", () => {
    expect(run("import sys\nsys.exit()\n").error).toBeNull();
    expect(run("import sys\nsys.exit(3)\n").error).toBe("The script exited with 3");
  });

  it("stops a loop at the time limit and says why", () => {
    const out = run("print('started')\nwhile True:\n    pass\n", 0.2);
    expect(out.stdout).toBe("started\n");
    expect(out.error).toContain("ran past its time limit");
  });
});
