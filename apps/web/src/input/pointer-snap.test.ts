import { describe, expect, it } from "vitest";
import {
  distanceToRect,
  NO_SNAP,
  nearestControl,
  type Rect,
  SNAP_CAPTURE_PX,
  SNAP_LATCH_MS,
  SNAP_RELEASE_PX,
  type SnapControl,
  type SnapInput,
  snappedPoint,
  stepHandSnap,
} from "./pointer-snap.ts";

const control = (key: string, left: number, top: number, width = 40, height = 32): SnapControl<string> => ({
  key,
  rect: { left, top, right: left + width, bottom: top + height },
});

const undo = control("undo", 100, 100);
const redo = control("redo", 200, 100);

const input = (over: Partial<SnapInput<string>>): SnapInput<string> => ({
  point: [0, 0],
  now: 0,
  controls: [undo, redo],
  enabled: true,
  closing: false,
  ringOpen: false,
  ...over,
});

describe("distance and placement", () => {
  const rect: Rect = { left: 100, top: 100, right: 140, bottom: 132 };

  it("is zero inside a control and measured to its edge outside", () => {
    expect(distanceToRect([120, 110], rect)).toBe(0);
    expect(distanceToRect([150, 110], rect)).toBe(10);
    expect(distanceToRect([143, 136], rect)).toBe(5);
  });

  it("draws the pointer at the centre of a small control and keeps it inside a wide one", () => {
    expect(snappedPoint([90, 90], rect)).toEqual([120, 116]);
    const row: Rect = { left: 0, top: 200, right: 360, bottom: 244 };
    expect(snappedPoint([500, 300], row)).toEqual([360, 244]);
    expect(snappedPoint([120, 230], row)).toEqual([120, 230]);
  });
});

describe("stepHandSnap", () => {
  it("a near miss snaps to the control (20 px away)", () => {
    const next = stepHandSnap(NO_SNAP, input({ point: [90 - 20 + 20, 116] }));
    expect(next.target?.key).toBe("undo");
    const miss = stepHandSnap(NO_SNAP, input({ point: [100 - 20, 116] }));
    expect(miss.target?.key).toBe("undo");
  });

  it("does not snap beyond the capture distance", () => {
    expect(stepHandSnap(NO_SNAP, input({ point: [100 - SNAP_CAPTURE_PX - 1, 116] })).target).toBeNull();
  });

  it("the nearest of two controls wins", () => {
    const a = control("a", 100, 100, 30);
    const b = control("b", 170, 100, 30); // 40 px between them
    const next = stepHandSnap(NO_SNAP, input({ controls: [a, b], point: [140, 116] })); // 10 from a, 30 from b
    expect(next.target?.key).toBe("a");
  });

  it("letting go needs a bigger distance than catching", () => {
    const snapped = stepHandSnap(NO_SNAP, input({ point: [90, 116] }));
    expect(snapped.target?.key).toBe("undo");
    const still = stepHandSnap(snapped, input({ point: [100 - 35, 116], now: 16 }));
    expect(still.target?.key).toBe("undo");
    const free = stepHandSnap(still, input({ point: [100 - SNAP_RELEASE_PX - 6, 116], now: 32 }));
    expect(free.target).toBeNull();
  });

  it("a pinch keeps its control however far the hand drifts", () => {
    const snapped = stepHandSnap(NO_SNAP, input({ point: [95, 116] }));
    const closing = stepHandSnap(snapped, input({ point: [95 - 60, 116], closing: true, now: 16 }));
    expect(closing.target?.key).toBe("undo");
    const later = stepHandSnap(closing, input({ point: [95 - 60, 116], closing: true, now: 300 }));
    expect(later.target?.key).toBe("undo");
  });

  it("the control is held a moment after the fingers open, for the tap that ends the pinch", () => {
    const snapped = stepHandSnap(NO_SNAP, input({ point: [95, 116] }));
    const closing = stepHandSnap(snapped, input({ point: [20, 116], closing: true, now: 100 }));
    const opened = stepHandSnap(closing, input({ point: [20, 116], now: 100 + SNAP_LATCH_MS - 10 }));
    expect(opened.target?.key).toBe("undo");
    const gone = stepHandSnap(opened, input({ point: [20, 116], now: 100 + SNAP_LATCH_MS + 20 }));
    expect(gone.target).toBeNull();
  });

  it("a pinch that began away from any control takes none on the way past one", () => {
    const orbiting = stepHandSnap(NO_SNAP, input({ point: [110, 116], closing: true }));
    expect(orbiting.target).toBeNull();
  });

  it("a ring being open, or the feature being off, frees the pointer", () => {
    const snapped = stepHandSnap(NO_SNAP, input({ point: [95, 116] }));
    expect(stepHandSnap(snapped, input({ point: [95, 116], ringOpen: true })).target).toBeNull();
    expect(stepHandSnap(snapped, input({ point: [95, 116], enabled: false })).target).toBeNull();
    expect(stepHandSnap(NO_SNAP, input({ point: [95, 116], enabled: false })).target).toBeNull();
  });

  it("a control that went away frees the pointer", () => {
    const snapped = stepHandSnap(NO_SNAP, input({ point: [95, 116] }));
    expect(stepHandSnap(snapped, input({ point: [95, 116], controls: [redo], now: 16 })).target).toBeNull();
  });

  it("a control that is not really under the pointer is skipped for the next one", () => {
    const next = stepHandSnap(
      NO_SNAP,
      input({
        controls: [undo, control("redo", 165, 100)],
        point: [150, 116],
        usable: (c) => c.key !== "undo",
      }), // undo is 10 px away but covered
    );
    expect(next.target?.key).toBe("redo");
  });

  it("a much nearer neighbour takes over from a snapped control", () => {
    const a = control("a", 100, 100, 30);
    const b = control("b", 150, 100, 30);
    const onA = stepHandSnap(NO_SNAP, input({ controls: [a, b], point: [135, 116] }));
    expect(onA.target?.key).toBe("a");
    const onB = stepHandSnap(onA, input({ controls: [a, b], point: [148, 116], now: 16 }));
    expect(onB.target?.key).toBe("b");
  });
});

describe("cost", () => {
  it("200 controls take well under 0.5 ms a frame", () => {
    const controls: Array<SnapControl<number>> = Array.from({ length: 200 }, (_, i) => ({
      key: i,
      rect: {
        left: (i % 20) * 60,
        top: Math.floor(i / 20) * 50,
        right: (i % 20) * 60 + 40,
        bottom: Math.floor(i / 20) * 50 + 32,
      },
    }));
    let state = NO_SNAP as ReturnType<typeof stepHandSnap<number>>;
    const frame = (i: number) => {
      state = stepHandSnap(state, {
        point: [(i * 7) % 1200, (i * 5) % 500],
        now: i * 16,
        controls,
        enabled: true,
        closing: false,
        ringOpen: false,
      });
    };
    for (let i = 0; i < 50; i++) frame(i);
    const start = performance.now();
    const frames = 500;
    for (let i = 0; i < frames; i++) frame(i);
    expect((performance.now() - start) / frames).toBeLessThan(0.5);
    expect(nearestControl([0, 0], controls, 30)?.control.key).toBe(0);
  });
});
