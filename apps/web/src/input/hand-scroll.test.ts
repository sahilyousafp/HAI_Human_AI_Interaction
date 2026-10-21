import { describe, expect, it } from "vitest";
import { COAST_TAU_MS, coastStep, grabScroll, releaseVelocity, type ScrollClock } from "./hand-scroll.ts";

/** A clock the test drives: frames run when `tick` is called. */
function fakeClock(): ScrollClock & { tick(ms: number): void; advance(ms: number): void } {
  let t = 0;
  let queued: Array<(t: number) => void> = [];
  return {
    now: () => t,
    frame: (callback) => {
      queued.push(callback);
      return queued.length;
    },
    cancel: () => {
      queued = [];
    },
    advance: (ms) => {
      t += ms;
    },
    tick(ms) {
      t += ms;
      const run = queued;
      queued = [];
      for (const callback of run) callback(t);
    },
  };
}

const area = (scrollTop = 500, max = 2000) => {
  let top = scrollTop;
  return {
    get scrollTop() {
      return top;
    },
    set scrollTop(v: number) {
      top = Math.max(0, Math.min(max, v));
    },
  } as unknown as HTMLElement;
};

describe("hand scrolling", () => {
  it("the content follows the hand: moving the hand down scrolls up", () => {
    const el = area(500);
    const grab = grabScroll(el, () => 1000, fakeClock());
    grab.move(0.1); // a tenth of the viewer's height down
    expect(el.scrollTop).toBe(400);
    grab.move(-0.25);
    expect(el.scrollTop).toBe(650);
  });

  it("a slow release stops where it is", () => {
    const clock = fakeClock();
    const el = area(500);
    const grab = grabScroll(el, () => 1000, clock);
    for (let i = 0; i < 5; i++) {
      clock.advance(40);
      grab.move(0.001); // 1 px per 40 ms
    }
    grab.release();
    clock.tick(16);
    expect(el.scrollTop).toBe(495);
  });

  it("a flick coasts on in the same direction and slows to a stop", () => {
    const clock = fakeClock();
    const el = area(1000, 5000);
    const grab = grabScroll(el, () => 1000, clock);
    for (let i = 0; i < 5; i++) {
      clock.advance(20);
      grab.move(-0.02); // hand moving up fast: 1 px per ms
    }
    const released = el.scrollTop;
    grab.release();
    clock.tick(16);
    const after = el.scrollTop;
    expect(after).toBeGreaterThan(released);
    for (let i = 0; i < 400; i++) clock.tick(16);
    const settled = el.scrollTop;
    clock.tick(16);
    expect(el.scrollTop).toBe(settled);
    // A 1 px/ms flick travels about tau px in all.
    expect(settled - released).toBeGreaterThan(COAST_TAU_MS * 0.8);
    expect(settled - released).toBeLessThan(COAST_TAU_MS * 1.1);
  });

  it("grabbing a coasting area catches it", () => {
    const clock = fakeClock();
    const el = area(1000, 5000);
    const grab = grabScroll(el, () => 1000, clock);
    for (let i = 0; i < 5; i++) {
      clock.advance(20);
      grab.move(-0.02);
    }
    grab.release();
    clock.tick(16);
    grabScroll(el, () => 1000, clock);
    const caught = el.scrollTop;
    clock.tick(16);
    expect(el.scrollTop).toBe(caught);
  });

  it("release speed and coasting maths", () => {
    expect(
      releaseVelocity(
        [
          { t: 0, y: 0 },
          { t: 50, y: 10 },
          { t: 100, y: 30 },
        ],
        100,
      ),
    ).toBeCloseTo(0.3);
    expect(releaseVelocity([{ t: 0, y: 0 }], 0)).toBe(0);
    const { move, velocity } = coastStep(1, COAST_TAU_MS);
    expect(velocity).toBeCloseTo(Math.exp(-1));
    expect(move).toBeCloseTo(COAST_TAU_MS * (1 - Math.exp(-1)));
  });
});
