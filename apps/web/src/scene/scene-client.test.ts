import type { Message, SceneDocument } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { SceneClient } from "./scene-client.ts";

const doc: SceneDocument = {
  version: 1,
  units: "mm",
  up: "Z",
  name: "T",
  levels: [{ id: "L0", name: "G", elevation: 0 }],
  elements: {
    c1: {
      id: "c1",
      type: "column",
      name: "C1",
      level: "L0",
      position: [0, 0],
      section: [400, 400],
      height: 3000,
      properties: {},
    },
  },
};

function setup() {
  const sent: Message[] = [];
  const client = new SceneClient((m) => {
    sent.push(m);
    return true;
  });
  client.handle({
    type: "scene.snapshot",
    id: "s",
    payload: { seq: 3, doc, selection: [], project: null, canUndo: false, canRedo: false },
  });
  return { client, sent };
}

const patch = (seq: number, ops: unknown[]): Message =>
  ({
    type: "scene.patch",
    id: `p${seq}`,
    payload: { seq, kind: "apply", label: "x", ops, canUndo: true, canRedo: false },
  }) as Message;

describe("SceneClient", () => {
  it("applies patches in sequence", () => {
    const { client } = setup();
    client.handle(patch(4, [{ op: "update", id: "c1", patch: { name: "Corner" } }]));
    expect(client.getSnapshot().doc?.elements.c1?.name).toBe("Corner");
    expect(client.getSnapshot().seq).toBe(4);
    expect(client.getSnapshot().canUndo).toBe(true);
  });

  it("keeps who made the last change, defaulting to the user", () => {
    const { client } = setup();
    client.handle({
      ...patch(4, [{ op: "update", id: "c1", patch: { name: "Corner" } }]),
      payload: { seq: 4, kind: "apply", label: "x", by: "architect", ops: [], canUndo: true, canRedo: false },
    } as Message);
    expect(client.getSnapshot().lastChange).toMatchObject({ by: "architect" });
  });

  it("asks for a snapshot when a patch is missing, and ignores the out-of-order one", () => {
    const { client, sent } = setup();
    client.handle(patch(6, [{ op: "delete", id: "c1" }]));
    expect(sent.map((m) => m.type)).toEqual(["scene.resync"]);
    expect(client.getSnapshot().doc?.elements.c1).toBeDefined();
  });

  it("shows a selection immediately and accepts the bridge's version", () => {
    const { client, sent } = setup();
    client.select(["c1", "ghost"]);
    expect(client.getSnapshot().selection).toEqual(["c1", "ghost"]);
    expect(sent.at(-1)).toMatchObject({ type: "selection.set", payload: { ids: ["c1", "ghost"] } });
    client.handle({ type: "selection.changed", id: "x", payload: { ids: ["c1"] } });
    expect(client.getSnapshot().selection).toEqual(["c1"]);
  });

  it("records rejected requests for the user", () => {
    const { client } = setup();
    client.handle({
      type: "request.error",
      id: "e",
      payload: { requestId: "r", message: "Nothing to undo" },
    });
    expect(client.getSnapshot().lastError).toBe("Nothing to undo");
  });

  it("a new project request names the folder, and its refusal is kept apart from other errors", () => {
    const { client, sent } = setup();
    client.createProject("D:/Projects/Fresh");
    const request = sent.at(-1);
    expect(request).toMatchObject({ type: "project.create", payload: { path: "D:/Projects/Fresh" } });
    // An unrelated rejection does not become the project message.
    client.handle({
      type: "request.error",
      id: "e1",
      payload: { requestId: "other", message: "Nothing to undo" },
    });
    expect(client.getSnapshot().projectMessage).toBeNull();
    client.handle({
      type: "request.error",
      id: "e2",
      payload: { requestId: request?.id ?? "", message: "That folder already holds a project." },
    });
    expect(client.getSnapshot().projectMessage).toBe("That folder already holds a project.");
    client.clearProjectMessage();
    expect(client.getSnapshot().projectMessage).toBeNull();
  });

  it("asking again clears the earlier message", () => {
    const { client, sent } = setup();
    client.openProject("D:/nope");
    client.handle({
      type: "request.error",
      id: "e",
      payload: { requestId: sent.at(-1)?.id ?? "", message: "Could not open" },
    });
    expect(client.getSnapshot().projectMessage).toBe("Could not open");
    client.createProject("D:/other");
    expect(client.getSnapshot().projectMessage).toBeNull();
  });
});
