import { describe, expect, it } from "vitest";
import { parseMessage } from "./messages.ts";

const parse = (type: string, payload: unknown) => parseMessage(JSON.stringify({ type, id: "m1", payload }));
const camera = { name: "south", azimuth: 270, elevation: 30, distance: 20000, target: [0, 0, 0] };

describe("agent cameras on the wire", () => {
  it("view.capture stays valid without an agent or cameras (the user's own view)", () => {
    expect(parse("view.capture", { requestId: "r" }).ok).toBe(true);
  });

  it("view.capture can name the agent, cameras, a size and what of the user's state to show", () => {
    const ok = parse("view.capture", {
      requestId: "r",
      agent: "architect",
      cameras: [camera],
      size: 512,
      options: { section: true },
    });
    expect(ok.ok).toBe(true);
    if (ok.ok && ok.message.type === "view.capture") {
      // What the agent leaves out stays off: the user's section and selection are not in a picture unless asked.
      expect(ok.message.payload.options).toEqual({ section: true, selection: false });
    }
  });

  it.each([
    ["no cameras in the list", { cameras: [] }],
    ["nine cameras", { cameras: Array.from({ length: 9 }, (_, i) => ({ ...camera, name: `c${i}` })) }],
    ["a size over 1280", { cameras: [camera], size: 2000 }],
    ["an unnamed camera", { cameras: [{ ...camera, name: "" }] }],
    ["a camera at no distance", { cameras: [{ ...camera, distance: 0 }] }],
  ])("view.capture refuses %s", (_name, extra) => {
    expect(parse("view.capture", { requestId: "r", ...extra }).ok).toBe(false);
  });

  it("view.captured carries one picture and thumbnail per camera, or an error", () => {
    const shot = { camera: "south", png: "iVBORw0KGgo=", thumb: "data:image/jpeg;base64,/9j/" };
    expect(parse("view.captured", { requestId: "r", shots: [shot] }).ok).toBe(true);
    expect(parse("view.captured", { requestId: "r", png: "iVBORw0KGgo=" }).ok).toBe(true);
    expect(parse("view.captured", { requestId: "r", error: "no" }).ok).toBe(true);
    expect(parse("view.captured", { requestId: "r", shots: [{ camera: "south", png: "x" }] }).ok).toBe(false);
  });

  it("team.snapshot lists cameras and last pictures, and an older snapshot without them still parses", () => {
    const base = { members: [], tasks: [], maxRunning: 3 };
    const old = parse("team.snapshot", base);
    expect(old.ok).toBe(true);
    if (old.ok && old.message.type === "team.snapshot") {
      expect(old.message.payload.shots).toEqual([]);
      expect(old.message.payload.cameras).toEqual([]);
    }
    const full = parse("team.snapshot", {
      ...base,
      shots: [{ agent: "architect", camera: "south", at: 1, thumb: "data:image/jpeg;base64,/9j/" }],
      cameras: [{ ...camera, agent: "architect" }],
    });
    expect(full.ok).toBe(true);
  });

  it("settings carry Show cameras, on unless switched off", () => {
    const set = parse("settings.set", { showCameras: false });
    expect(set.ok).toBe(true);
  });
});
