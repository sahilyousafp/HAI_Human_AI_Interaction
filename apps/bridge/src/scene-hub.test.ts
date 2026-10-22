import { mkdtempSync, readFileSync, renameSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import { connectClient } from "../test/ws-client.ts";
import {
  defaultProjectDir,
  openProject,
  readLastProject,
  SCENE_FILE,
  writeLastProject,
  writeSceneAtomic,
} from "./project.ts";
import { type Bridge, createBridge } from "./server.ts";

const ORIGIN = "http://localhost:5173";
const TOKEN = "scene-test-token-0123456789";
let bridge: Bridge | null = null;
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.close();
  await bridge?.stop();
  bridge = null;
});

async function start(scene: Parameters<typeof createBridge>[0]["scene"] = {}): Promise<AddressInfo> {
  bridge = createBridge({
    host: "127.0.0.1",
    port: 0,
    allowedOrigins: [ORIGIN],
    version: "t",
    token: TOKEN,
    scene,
  });
  return bridge.start();
}

const client = (address: AddressInfo) =>
  connectClient(address, { token: TOKEN, origin: ORIGIN, track: sockets });

describe("scene store over the bridge", () => {
  it("sends a snapshot of the sample scene on connect", async () => {
    const a = await client(await start());
    const snap = await a.waitFor("scene.snapshot");
    expect(snap.payload.seq).toBe(0);
    expect(Object.keys(snap.payload.doc.elements).length).toBeGreaterThan(10);
  });

  it("two clients stay in sync: a delete reaches the other client within 200 ms", async () => {
    const address = await start();
    const a = await client(address);
    const b = await client(address);
    const t0 = Date.now();
    a.send("scene.apply", { label: "Delete column", ops: [{ op: "delete", id: "col-a1" }] });
    const patch = await b.waitFor("scene.patch", (m) => m.payload.seq === 1);
    expect(Date.now() - t0).toBeLessThan(200);
    expect(patch.payload.ops).toEqual([{ op: "delete", id: "col-a1" }]);
    expect(bridge?.scene.scene.doc.elements["col-a1"]).toBeUndefined();
  });

  it("patches carry increasing sequence numbers and undo is a patch too", async () => {
    const a = await client(await start());
    a.send("scene.apply", {
      label: "Rename",
      ops: [{ op: "update", id: "wall-n", patch: { name: "North" } }],
    });
    a.send("scene.undo", {});
    const undo = await a.waitFor("scene.patch", (m) => m.payload.kind === "undo");
    expect(undo.payload.seq).toBe(2);
    expect(undo.payload.label).toBe("Rename");
    expect(bridge?.scene.scene.doc.elements["wall-n"]?.name).toBe("North wall");
  });

  it("resync: a client that asks gets a fresh snapshot with the current sequence", async () => {
    const a = await client(await start());
    a.send("scene.apply", { label: "Delete", ops: [{ op: "delete", id: "col-b2" }] });
    await a.waitFor("scene.patch");
    a.send("scene.resync", {});
    const snap = await a.waitFor("scene.snapshot", (m) => m.payload.seq === 1);
    expect(snap.payload.doc.elements["col-b2"]).toBeUndefined();
  });

  it("an invalid transaction is rejected to the sender only and changes nothing", async () => {
    const address = await start();
    const a = await client(address);
    const b = await client(address);
    a.send(
      "scene.apply",
      { label: "Bad", ops: [{ op: "update", id: "wall-n", patch: { thickness: -1 } }] },
      "bad-1",
    );
    const error = await a.waitFor("request.error");
    expect(error.payload).toEqual({
      requestId: "bad-1",
      message: 'Element "wall-n": thickness must be greater than 0',
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(b.received.some((m) => m.type === "scene.patch")).toBe(false);
  });
});

describe("selection", () => {
  it("selection visible to other clients", async () => {
    const address = await start();
    const a = await client(address);
    const b = await client(address);
    a.send("selection.set", { ids: ["wall-n", "not-a-real-id"] });
    const changed = await b.waitFor("selection.changed");
    expect(changed.payload.ids).toEqual(["wall-n"]);
    expect(bridge?.scene.scene.selection).toEqual(["wall-n"]);
  });

  it("deleting a selected element removes it from the selection", async () => {
    const a = await client(await start());
    a.send("selection.set", { ids: ["col-c3"] });
    await a.waitFor("selection.changed");
    a.send("scene.apply", { label: "Delete", ops: [{ op: "delete", id: "col-c3" }] });
    const changed = await a.waitFor("selection.changed", (m) => m.payload.ids.length === 0);
    expect(changed.payload.ids).toEqual([]);
  });
});

describe("project persistence", () => {
  const tempProject = () => join(mkdtempSync(join(tmpdir(), "hai-project-")), "my-project");

  it("autosave: the project file contains a change within 2 seconds of the last edit", async () => {
    const dir = tempProject();
    const a = await client(await start({ projectDir: dir }));
    a.send("scene.apply", {
      label: "Rename",
      ops: [{ op: "update", id: "block-b", patch: { name: "Tower" } }],
    });
    await a.waitFor("scene.patch");
    const t0 = Date.now();
    const saved = await a.waitFor("project.status", (m) => m.payload.savedAt !== null, 3000);
    expect(Date.now() - t0).toBeLessThan(2500);
    expect(saved.payload.error).toBeNull();
    const onDisk = JSON.parse(readFileSync(join(dir, SCENE_FILE), "utf8"));
    expect(onDisk.elements["block-b"].name).toBe("Tower");
  });

  it("round trip keeps units: a 300 mm wall reads 300 after save and reload, based at its level", async () => {
    const dir = tempProject();
    const opened = openProject(dir);
    if (!opened.ok) throw new Error(opened.error);
    await writeSceneAtomic(dir, opened.doc);
    const reloaded = openProject(dir);
    if (!reloaded.ok) throw new Error(reloaded.error);
    const wall = reloaded.doc.elements["wall-n"];
    expect(wall?.type === "wall" && wall.thickness).toBe(300);
    expect(reloaded.doc.units).toBe("mm");
    expect(reloaded.doc.levels.find((l) => l.id === wall?.level)?.elevation).toBe(4500);
  });

  it("an atomic save retries while Windows holds the file, then succeeds", async () => {
    const dir = tempProject();
    const opened = openProject(dir);
    if (!opened.ok) throw new Error(opened.error);
    let failures = 2;
    const flaky = (from: string, to: string) => {
      if (failures-- > 0) throw Object.assign(new Error("busy"), { code: "EPERM" });
      renameSync(from, to);
    };
    await writeSceneAtomic(dir, { ...opened.doc, name: "Saved after retry" }, [1, 1, 1], flaky);
    expect(JSON.parse(readFileSync(join(dir, SCENE_FILE), "utf8")).name).toBe("Saved after retry");
  });

  it("an atomic save gives up after its retries", async () => {
    const dir = tempProject();
    const opened = openProject(dir);
    if (!opened.ok) throw new Error(opened.error);
    const locked = () => {
      throw Object.assign(new Error("busy"), { code: "EBUSY" });
    };
    await expect(writeSceneAtomic(dir, opened.doc, [1, 1], locked)).rejects.toThrow("busy");
  });

  it("remembers the last opened project", () => {
    const root = mkdtempSync(join(tmpdir(), "hai-root-"));
    expect(readLastProject(root)).toBeNull();
    writeLastProject(root, "D:/Projects/House");
    expect(readLastProject(root)).toBe("D:/Projects/House");
    expect(defaultProjectDir(root)).toContain(join(".hai", "projects", "sample"));
  });

  it("opening another project folder sends everyone the new scene", async () => {
    const address = await start({ projectDir: tempProject() });
    const a = await client(address);
    const b = await client(address);
    const other = tempProject();
    a.send("project.open", { path: other });
    const status = await b.waitFor(
      "project.status",
      (m) => m.payload.project?.path.endsWith("my-project") ?? false,
    );
    expect(status.payload.error).toBeNull();
  });

  it("a new project opens empty for everyone: one ground level, no elements, nothing selected", async () => {
    const address = await start({ projectDir: tempProject() });
    const a = await client(address);
    const b = await client(address);
    const dir = join(tempProject(), "fresh");
    a.send("project.create", { path: dir });
    const snap = await b.waitFor("scene.snapshot", (m) => m.payload.project?.path === dir);
    expect(snap.payload.doc.elements).toEqual({});
    expect(snap.payload.doc.levels).toEqual([{ id: "L0", name: "Ground", elevation: 0 }]);
    expect(snap.payload.doc.name).toBe("fresh");
    expect(snap.payload.selection).toEqual([]);
    expect(snap.payload.canUndo).toBe(false);
    expect(JSON.parse(readFileSync(join(dir, SCENE_FILE), "utf8")).elements).toEqual({});
  });

  it("a folder that already holds a project is not touched, and the sender is told", async () => {
    const existing = tempProject();
    const address = await start({ projectDir: existing });
    const a = await client(address);
    const before = readFileSync(join(existing, SCENE_FILE), "utf8");
    a.send("project.create", { path: existing });
    const error = await a.waitFor("request.error");
    expect(error.payload.message).toMatch(/already holds a project/);
    expect(readFileSync(join(existing, SCENE_FILE), "utf8")).toBe(before);
    // The open project and its scene are unchanged.
    expect(Object.keys(bridge?.scene.scene.doc.elements ?? {}).length).toBeGreaterThan(10);
  });
});
