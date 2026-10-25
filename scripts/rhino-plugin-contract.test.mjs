import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseMessage } from "../packages/protocol/src/index.ts";
import { decodeMeshAsset } from "../packages/scene/src/index.ts";

// The Rhino plugin (plugins/rhino) is written in C#. These files are the contract between it and the bridge: the C#
// tests write the messages the plugin sends and the mesh asset it makes, and compare them with the files here (set
// HAI_UPDATE_FIXTURES=1 to write them again); this test makes the TypeScript side read the same files with the real
// schemas and the real reader. A change to either language that breaks the other fails one of the two.

const fixtures = join(import.meta.dirname, "..", "plugins", "rhino", "tests", "fixtures");
const named = (prefix) =>
  readdirSync(fixtures)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
    .sort();

describe("what the plugin sends", () => {
  const files = named("message-");
  it("has every kind of message the plugin sends", () => {
    expect(files).toEqual([
      "message-hello-no-python.json",
      "message-hello.json",
      "message-objects.json",
      "message-python-error.json",
      "message-python-result-changes.json",
      "message-python-result.json",
      "message-selection.json",
      "message-status.json",
    ]);
  });

  for (const file of files) {
    it(`${file} is accepted by the bridge's schemas`, () => {
      const parsed = parseMessage(readFileSync(join(fixtures, file), "utf8"));
      expect(parsed.ok, parsed.ok ? "" : JSON.stringify(parsed.error)).toBe(true);
    });
  }

  it("a hello says it is Rhino, and what Python can do", () => {
    const ok = parseMessage(readFileSync(join(fixtures, "message-hello.json"), "utf8"));
    expect(ok.ok && ok.message.type === "hello" && ok.message.payload.client).toBe("rhino");
    const none = parseMessage(readFileSync(join(fixtures, "message-hello-no-python.json"), "utf8"));
    expect(none.ok && none.message.type === "hello" && none.message.payload).toMatchObject({
      client: "rhino",
      python: { state: "unavailable" },
      document: null,
    });
  });

  it("a run's result carries what it added, changed and deleted, with their tags", () => {
    const parsed = parseMessage(readFileSync(join(fixtures, "message-python-result-changes.json"), "utf8"));
    expect(parsed.ok && parsed.message.type === "rhino.python.result").toBe(true);
    if (!parsed.ok || parsed.message.type !== "rhino.python.result") return;
    const { changes } = parsed.message.payload;
    expect(changes?.added[0]).toMatchObject({
      id: "a-1",
      tags: { "hai.owner": "architect", "hai.part": "dome" },
    });
    expect(changes?.changed[0]?.bounds).toBeNull();
    expect(changes?.deleted.map((c) => c.id)).toEqual(["d-1"]);
  });

  it("a batch names an object with no colour and no mesh the way the viewer expects", () => {
    const parsed = parseMessage(readFileSync(join(fixtures, "message-objects.json"), "utf8"));
    expect(parsed.ok && parsed.message.type === "rhino.objects").toBe(true);
    if (!parsed.ok || parsed.message.type !== "rhino.objects") return;
    const [canopy, bare] = parsed.message.payload.changed;
    expect(canopy).toMatchObject({ layer: "Roof::Canopy", color: "#3c6ec8", triangles: 1152 });
    expect(canopy?.tags).toEqual({ "hai.owner": "architect" });
    expect(bare).toMatchObject({ color: null, asset: null, triangles: 0 });
    expect(parsed.message.payload.sync).toEqual({ done: 2, total: 40 });
    expect(parsed.message.payload.reset).toBe(true);
  });
});

describe("what the bridge sends the plugin", () => {
  const files = named("bridge-");
  it("has the requests the plugin answers", () => {
    expect(files).toEqual([
      "bridge-open.json",
      "bridge-python-run-claimed.json",
      "bridge-python-run.json",
      "bridge-select-clear.json",
      "bridge-select.json",
      "bridge-undo.json",
    ]);
  });

  for (const file of files) {
    it(`${file} is a message the bridge's schemas produce`, () => {
      const parsed = parseMessage(readFileSync(join(fixtures, file), "utf8"));
      expect(parsed.ok, parsed.ok ? "" : JSON.stringify(parsed.error)).toBe(true);
    });
  }
});

describe("a run request that names its agent and claim", () => {
  it("is read with the agent, the title, the part and the claim", () => {
    const parsed = parseMessage(readFileSync(join(fixtures, "bridge-python-run-claimed.json"), "utf8"));
    expect(parsed.ok && parsed.message.type === "rhino.python.run").toBe(true);
    if (!parsed.ok || parsed.message.type !== "rhino.python.run") return;
    expect(parsed.message.payload).toMatchObject({
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
