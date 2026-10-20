import type { Message } from "@aex/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureSize, ViewLink } from "./view-link.ts";

const camera = {
  azimuth: 305.04,
  elevation: 32,
  distance: 70_000.4,
  target: [20_000, 15_000, 3000] as const,
};

function setup() {
  const sent: Message[] = [];
  const link = new ViewLink((m) => {
    sent.push(m);
    return true;
  }, 200);
  const updates = () => sent.filter((m) => m.type === "context.update");
  return { link, sent, updates };
}

describe("captureSize", () => {
  it("scales the longest side down to 1280 and keeps the aspect", () => {
    expect(captureSize(2560, 1440)).toEqual([1280, 720]);
    expect(captureSize(900, 1800)).toEqual([640, 1280]);
  });

  it("never enlarges a small view", () => {
    expect(captureSize(800, 600)).toEqual([800, 600]);
  });
});

describe("ViewLink context", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends one update per burst, rounded, and none when nothing changed", () => {
    const { link, updates } = setup();
    link.setCamera({ ...camera, target: [...camera.target] });
    link.setPointed("col-a1");
    link.setCamera({ ...camera, azimuth: 305.01, target: [...camera.target] });
    vi.advanceTimersByTime(200);
    expect(updates()).toHaveLength(1);
    expect(updates()[0]?.payload).toEqual({
      pointed: "col-a1",
      camera: { azimuth: 305, elevation: 32, distance: 70_000, target: [20_000, 15_000, 3000] },
    });
    link.setPointed("col-a1");
    vi.advanceTimersByTime(200);
    expect(updates()).toHaveLength(1);
  });

  it("tells a (re)connected bridge the context again", () => {
    const { link, updates } = setup();
    link.setPointed("wall-n");
    vi.advanceTimersByTime(200);
    const snapshot = { type: "scene.snapshot", id: "s", payload: {} } as unknown as Message;
    expect(link.handle(snapshot)).toBe(false);
    vi.advanceTimersByTime(200);
    expect(updates()).toHaveLength(2);
  });
});

describe("ViewLink capture", () => {
  const request: Message = { type: "view.capture", id: "r", payload: { requestId: "req-1" } };
  const captured = async (sent: Message[]) => {
    await vi.waitFor(() => expect(sent.some((m) => m.type === "view.captured")).toBe(true));
    return sent.find((m) => m.type === "view.captured")?.payload;
  };

  it("answers with the PNG from the viewer", async () => {
    const { link, sent } = setup();
    link.attachCapture(async () => "iVBORw0KGgo=");
    expect(link.handle(request)).toBe(true);
    expect(await captured(sent)).toEqual({ requestId: "req-1", png: "iVBORw0KGgo=" });
  });

  it("answers with an error when the viewer is not ready or capture fails", async () => {
    const first = setup();
    first.link.handle(request);
    expect(await captured(first.sent)).toMatchObject({ requestId: "req-1", error: /starting/ });

    const second = setup();
    second.link.attachCapture(async () => {
      throw new Error("lost the WebGL context");
    });
    second.link.handle(request);
    expect(await captured(second.sent)).toMatchObject({ error: "lost the WebGL context" });
  });
});
