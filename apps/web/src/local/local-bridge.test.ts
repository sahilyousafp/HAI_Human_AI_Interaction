import type { Message } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import type { ConnectionState } from "../bridge/connection.ts";
import { LocalBridge, sampleDocument } from "./local-bridge.ts";

/** A client of the in-page hub: every message it gets, in order, after the microtask that delivers it. */
function client() {
  const hub = new LocalBridge();
  const got: Message[] = [];
  const states: ConnectionState[] = [];
  const connection = hub.connect(
    (state) => states.push(state),
    (message) => got.push(message),
  );
  const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve));
  const of = (type: string) => got.filter((m) => m.type === type);
  return { hub, connection, got, states, settle, of };
}

const message = (type: string, payload: unknown): Message =>
  ({ type, id: crypto.randomUUID(), payload }) as Message;

describe("the bridge in the page", () => {
  it("is connected at once, and greets with settings, the sample scene and a project status", async () => {
    const { states, settle, of } = client();
    await settle();
    expect(states).toEqual([{ status: "connected", clients: 1, bridgeVersion: "in this tab" }]);
    expect(of("settings.snapshot")).toHaveLength(1);
    const scene = of("scene.snapshot")[0] as Extract<Message, { type: "scene.snapshot" }>;
    expect(Object.keys(scene.payload.doc.elements).length).toBeGreaterThan(3);
    expect(scene.payload.canUndo).toBe(false);
    expect(of("project.status")).toHaveLength(1);
  });

  it("starts with the features that need an agent, a bridge or a download off", async () => {
    const { settle, of } = client();
    await settle();
    const settings = of("settings.snapshot")[0] as Extract<Message, { type: "settings.snapshot" }>;
    expect(settings.payload.features).toMatchObject({ agent: false, voice: false, openData: false });
  });

  it("applies a change as one patch, undoes it, redoes it, and says what can be undone", async () => {
    const { connection, settle, of } = client();
    const first = Object.keys(sampleDocument().elements)[0] as string;
    expect(
      connection.send(message("scene.apply", { label: "Delete", ops: [{ op: "delete", id: first }] })),
    ).toBe(true);
    await settle();
    const patch = of("scene.patch").at(-1) as Extract<Message, { type: "scene.patch" }>;
    expect(patch.payload).toMatchObject({
      seq: 1,
      kind: "apply",
      label: "Delete",
      canUndo: true,
      canRedo: false,
    });
    connection.send(message("scene.undo", {}));
    await settle();
    expect(of("scene.patch").at(-1)).toMatchObject({ payload: { seq: 2, kind: "undo", canRedo: true } });
    connection.send(message("scene.redo", {}));
    await settle();
    expect(of("scene.patch").at(-1)).toMatchObject({ payload: { seq: 3, kind: "redo" } });
  });

  it("refuses a change the scene cannot take, with the reason, and changes nothing", async () => {
    const { connection, settle, of } = client();
    connection.send(message("scene.apply", { label: "Bad", ops: [{ op: "delete", id: "no-such-element" }] }));
    await settle();
    expect(of("scene.patch")).toHaveLength(0);
    expect(of("request.error")).toHaveLength(1);
  });

  it("keeps the selection and sends it back", async () => {
    const { connection, settle, of } = client();
    const first = Object.keys(sampleDocument().elements)[0] as string;
    connection.send(message("selection.set", { ids: [first] }));
    await settle();
    expect(of("selection.changed").at(-1)).toMatchObject({ payload: { ids: [first] } });
  });

  it("answers a resync with a whole snapshot", async () => {
    const { connection, settle, of } = client();
    await settle();
    connection.send(message("scene.resync", {}));
    await settle();
    expect(of("scene.snapshot")).toHaveLength(2);
  });

  it("says projects on disk are the desktop app's, and the open one stays", async () => {
    const { connection, settle, of } = client();
    connection.send(message("project.open", { path: "D:/projects/x" }));
    await settle();
    expect((of("request.error")[0] as Extract<Message, { type: "request.error" }>).payload.message).toMatch(
      /desktop app/,
    );
  });

  it("does not answer what only a real bridge can (the agent, Rhino), so the app drops it as offline", () => {
    const { connection } = client();
    expect(connection.send(message("agent.send", { text: "hi", agent: null }))).toBe(false);
  });

  it("keeps imported geometry in memory and serves it where the app asks, and says so when it is not there", async () => {
    const { hub } = client();
    hub.putAsset("abc", new Uint8Array([1, 2, 3]));
    const found = await hub.fetchAsset(hub.assetUrl(0, "abc"));
    expect(found.ok).toBe(true);
    expect([...new Uint8Array(await found.arrayBuffer())]).toEqual([1, 2, 3]);
    expect((await hub.fetchAsset(hub.assetUrl(0, "missing"))).status).toBe(404);
  });

  it("stops delivering once the connection is closed", async () => {
    const { connection, got, settle } = client();
    await settle();
    const before = got.length;
    connection.close();
    connection.send(message("scene.resync", {}));
    await settle();
    expect(got.length).toBe(before);
  });
});
