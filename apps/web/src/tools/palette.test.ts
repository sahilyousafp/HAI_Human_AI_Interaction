import { describe, expect, it } from "vitest";
import { DEAD_ZONE, PaletteMachine, slotAt } from "./palette.ts";

const space = { center: [0.5, 0.5] as [number, number], aspect: 4 / 3 };

describe("slotAt", () => {
  it("is null inside the 4% dead zone and picks a slot just beyond it", () => {
    expect(slotAt(space, [0.5 + DEAD_ZONE * 0.9, 0.5])).toBeNull();
    expect(slotAt(space, [0.5 + DEAD_ZONE * 1.1, 0.5])).toBe(2);
  });

  it("numbers slots clockwise from straight up", () => {
    const d = 0.1;
    expect(slotAt(space, [0.5, 0.5 - d])).toBe(0);
    expect(slotAt(space, [0.5 + d, 0.5 - d * (4 / 3)])).toBe(1); // 45 degrees in width units
    expect(slotAt(space, [0.5 + d, 0.5])).toBe(2);
    expect(slotAt(space, [0.5, 0.5 + d])).toBe(4);
    expect(slotAt(space, [0.5 - d, 0.5])).toBe(6);
    expect(slotAt(space, [0.5 - d, 0.5 - d * (4 / 3)])).toBe(7);
  });

  it("measures the dead zone in widths on both axes", () => {
    // 0.05 of the height is 0.0375 of the width at 4:3: still inside the dead zone.
    expect(slotAt(space, [0.5, 0.55])).toBeNull();
    expect(slotAt(space, [0.5, 0.56])).toBe(4);
  });
});

describe("PaletteMachine", () => {
  it("palette opens: centred where it was opened, nothing highlighted", () => {
    const m = new PaletteMachine();
    m.open(space);
    expect(m.state).toEqual({ ...space, highlighted: null });
  });

  it("flick right to choose: highlights the right slot and returns it on release", () => {
    const m = new PaletteMachine();
    m.open(space);
    m.steer([0.53, 0.5]);
    m.steer([0.6, 0.51]);
    expect(m.state?.highlighted).toBe(2);
    expect(m.release()).toBe(2);
    expect(m.isOpen).toBe(false);
  });

  it("release in the centre cancels: no slot", () => {
    const m = new PaletteMachine();
    m.open(space);
    m.steer([0.6, 0.5]);
    m.steer([0.51, 0.5]); // back inside the dead zone
    expect(m.release()).toBeNull();
    expect(m.isOpen).toBe(false);
  });
});
