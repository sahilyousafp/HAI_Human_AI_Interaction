import { describe, expect, it } from "vitest";
import { HoldMachine, RING_AFTER_MS } from "./hold.ts";

const space = { center: [0.5, 0.5] as [number, number], aspect: 4 / 3 };
const right: [number, number] = [0.62, 0.5];

describe("a held pinch", () => {
  it("speech, then release: the request is sent, and the ring never shows", () => {
    const hold = new HoldMachine(space, 0);
    hold.speech();
    expect(hold.state(RING_AFTER_MS + 100)).toEqual({ phase: "speaking", slot: null, ringShown: false });
    expect(hold.release()).toEqual({ kind: "send" });
  });

  it("Silent flick picks a tool: a move right within 300 ms highlights the right slot at once, and release chooses it", () => {
    const hold = new HoldMachine(space, 0);
    hold.move(right);
    expect(hold.state(300)).toEqual({ phase: "flicking", slot: 2, ringShown: true });
    expect(hold.release()).toEqual({ kind: "choose", slot: 2 });
  });

  it("Ring fades in after silence: held still and silent, the ring shows after 600 ms", () => {
    const hold = new HoldMachine(space, 1000);
    expect(hold.state(1000 + RING_AFTER_MS - 1).ringShown).toBe(false);
    expect(hold.state(1000 + RING_AFTER_MS).ringShown).toBe(true);
  });

  it("silence and a release in the centre cancel: nothing is chosen or sent", () => {
    const hold = new HoldMachine(space, 0);
    hold.move([0.51, 0.5]);
    expect(hold.state(100).phase).toBe("held");
    expect(hold.release()).toEqual({ kind: "cancel" });
  });

  it("moving back to the centre after a flick takes the slot back", () => {
    const hold = new HoldMachine(space, 0);
    hold.move(right);
    hold.move([0.5, 0.5]);
    expect(hold.release()).toEqual({ kind: "cancel" });
  });

  it("Speech wins over a flick: once speech starts the slot is dropped, later moves point, and release sends", () => {
    const hold = new HoldMachine(space, 0);
    hold.move(right);
    hold.speech();
    hold.move([0.7, 0.5]);
    expect(hold.state(1000)).toEqual({ phase: "speaking", slot: null, ringShown: false });
    expect(hold.release()).toEqual({ kind: "send" });
  });
});
