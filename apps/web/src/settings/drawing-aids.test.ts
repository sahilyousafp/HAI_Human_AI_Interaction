import { describe, expect, it, vi } from "vitest";
import { DrawingAidsStore } from "./drawing-aids.ts";

describe("DrawingAidsStore", () => {
  it("starts with only Grid on", () => {
    const store = new DrawingAidsStore(() => true);
    expect(store.on("grid")).toBe(true);
    expect(store.on("ortho")).toBe(false);
  });

  it("a switch applies at once, is sent as one choice and tells subscribers", () => {
    const save = vi.fn(() => true);
    const store = new DrawingAidsStore(save);
    const listener = vi.fn();
    store.subscribe(listener);
    store.set("endpoint", true);
    expect(store.on("endpoint")).toBe(true);
    expect(save).toHaveBeenCalledWith({ endpoint: true });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("stored choices from the bridge replace what the page shows", () => {
    const store = new DrawingAidsStore(() => true);
    store.load({ ortho: true, grid: false });
    expect(store.getSnapshot()).toMatchObject({ ortho: true, grid: false, midpoint: false });
    store.load(null);
    expect(store.getSnapshot().grid).toBe(true);
  });
});
