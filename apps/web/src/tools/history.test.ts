import { describe, expect, it } from "vitest";
import { EditHistory } from "./history.ts";

function setup(sendable = true) {
  const sent: string[] = [];
  const history = new EditHistory({
    undoScene: () => sent.push("scene.undo") > 0 && sendable,
    redoScene: () => sent.push("scene.redo") > 0 && sendable,
    undoHost: (host) => sent.push(`${host}.undo`) > 0 && sendable,
    redoHost: (host) => sent.push(`${host}.redo`) > 0 && sendable,
  });
  return { history, sent };
}

describe("one undo order across the scene and the hosts", () => {
  it("undo a host edit, then a scene edit: each goes back where it was made, the last first", () => {
    const { history, sent } = setup();
    history.record({ kind: "scene" });
    history.record({ kind: "host", host: "rhino" });
    history.undo();
    history.undo();
    expect(sent).toEqual(["rhino.undo", "scene.undo"]);
  });

  it("redo a host edit: Redo goes to the host, in the order the edits were undone", () => {
    const { history, sent } = setup();
    history.record({ kind: "host", host: "rhino" });
    history.record({ kind: "scene" });
    history.undo();
    history.undo();
    history.redo();
    history.redo();
    expect(sent).toEqual(["scene.undo", "rhino.undo", "rhino.redo", "scene.redo"]);
  });

  it("a new edit after an undo means there is nothing to redo, and Redo goes to the scene", () => {
    const { history, sent } = setup();
    history.record({ kind: "host", host: "rhino" });
    history.undo();
    history.record({ kind: "scene" });
    expect(history.hostRedo).toBeNull();
    history.redo();
    expect(sent.at(-1)).toBe("scene.redo");
  });

  it("with nothing remembered, Undo goes to the scene as before", () => {
    const { history, sent } = setup();
    history.undo();
    expect(sent).toEqual(["scene.undo"]);
  });

  it("a step that could not be sent stays to be undone", () => {
    const { history, sent } = setup(false);
    history.record({ kind: "host", host: "blender" });
    history.undo();
    expect(history.hostUndo).toBe("blender");
    expect(sent).toEqual(["blender.undo"]);
  });

  it("a host whose document changed is forgotten, and Undo goes on to the edit before", () => {
    const { history, sent } = setup();
    history.record({ kind: "scene" });
    history.record({ kind: "host", host: "rhino" });
    history.forgetHost("rhino");
    history.undo();
    expect(sent).toEqual(["scene.undo"]);
  });
});
