import { describe, expect, it, vi } from "vitest";
import { hostLink } from "./host-link.ts";

describe("hostLink", () => {
  it("is null when the bridge was started from a terminal", () => {
    expect(hostLink({ on: vi.fn() })).toBeNull();
  });

  it("talks through Electron's parent port", () => {
    let listener: (event: { data: unknown }) => void = () => {};
    const parentPort = {
      postMessage: vi.fn(),
      on: (_event: "message", l: (event: { data: unknown }) => void) => {
        listener = l;
      },
    };
    const link = hostLink({ parentPort, on: vi.fn() });
    link?.send({ type: "ready", port: 4870, token: "t" });
    expect(parentPort.postMessage).toHaveBeenCalledWith({ type: "ready", port: 4870, token: "t" });

    const stop = vi.fn();
    link?.onStop(stop);
    listener({ data: { type: "hello" } });
    expect(stop).not.toHaveBeenCalled();
    listener({ data: { type: "stop" } });
    expect(stop).toHaveBeenCalledOnce();
  });

  it("talks through a Node child's channel", () => {
    let listener: (message: unknown) => void = () => {};
    const proc = {
      send: vi.fn(() => true),
      on: (_event: "message", l: (message: unknown) => void) => {
        listener = l;
      },
    };
    const link = hostLink(proc);
    link?.send({ type: "ready", port: 1, token: "t" });
    expect(proc.send).toHaveBeenCalledWith({ type: "ready", port: 1, token: "t" });

    const stop = vi.fn();
    link?.onStop(stop);
    listener("stop");
    listener(null);
    listener({ type: "stop" });
    expect(stop).toHaveBeenCalledOnce();
  });
});
