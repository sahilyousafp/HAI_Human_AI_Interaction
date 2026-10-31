import type { ModelsState } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { formatBytes, modelsView } from "./models-view.ts";

const ITEMS = [
  { id: "moonshine-small", bytes: 169_500_000 },
  { id: "kokoro", bytes: 326_600_000 },
];
const TOTAL = 496_100_000;

describe("formatBytes", () => {
  it.each([
    [0, "under 1 MB"],
    [40_000, "under 1 MB"],
    [522_240, "0.5 MB"],
    [7_819_105, "7.8 MB"],
    [169_500_000, "170 MB"],
    [326_600_000, "327 MB"],
    [496_100_000, "496 MB"],
    [999_400_000, "999 MB"],
    [1_200_000_000, "1.2 GB"],
  ])("%d is %s", (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });
});

describe("modelsView", () => {
  it("says nothing while the app is still looking at the disk", () => {
    expect(modelsView({ status: "checking" })).toBeNull();
  });

  it("offers to download, with the total size and what each part is for", () => {
    const view = modelsView({ status: "needed", files: 14, totalBytes: TOTAL, items: ITEMS });
    expect(view?.tone).toBe("idle");
    expect(view?.headline).toBe("Download the voice models");
    expect(view?.detail).toContain("about 496 MB");
    expect(view?.detail).toContain("Camera and hands work without it");
    expect(view?.items).toEqual([
      {
        id: "moonshine-small",
        title: "Speech to text",
        detail: "Understands what you say",
        size: "170 MB",
        state: "waiting",
      },
      {
        id: "kokoro",
        title: "Spoken replies",
        detail: "Reads the agent's answers aloud",
        size: "327 MB",
        state: "waiting",
      },
    ]);
    expect(view?.progress).toBeNull();
    expect(view?.actions).toEqual([
      { id: "download", label: "Download", primary: true },
      { id: "skip", label: "Continue without voice", primary: false },
    ]);
  });

  describe("while downloading", () => {
    const downloading = (receivedBytes: number): ModelsState => ({
      status: "downloading",
      file: "models/kokoro/onnx/model.onnx",
      fileNumber: 9,
      fileCount: 14,
      receivedBytes,
      totalBytes: TOTAL,
      items: ITEMS,
    });

    it("shows progress as a fraction and in sizes, and lets the user continue or stop", () => {
      const view = modelsView(downloading(248_050_000));
      expect(view?.tone).toBe("busy");
      expect(view?.headline).toBe("Downloading the voice models");
      expect(view?.progress).toBeCloseTo(0.5, 5);
      expect(view?.progressLabel).toBe("248 MB of 496 MB");
      expect(view?.actions.map((a) => a.id)).toEqual(["continue", "cancel"]);
      expect(view?.actions[0]?.primary).toBe(true);
    });

    it("marks the finished part done and the current one active", () => {
      const view = modelsView(downloading(200_000_000));
      expect(view?.items.map((i) => i.state)).toEqual(["done", "active"]);
    });

    it("marks the first part active at the start, and both done at the end", () => {
      expect(modelsView(downloading(0))?.items.map((i) => i.state)).toEqual(["active", "waiting"]);
      expect(modelsView(downloading(TOTAL))?.items.map((i) => i.state)).toEqual(["done", "done"]);
    });

    it("never reports more than 100 percent", () => {
      expect(modelsView(downloading(TOTAL * 2))?.progress).toBe(1);
    });
  });

  describe("when it fails", () => {
    const failed = (reason: "offline" | "server" | "rejected"): ModelsState => ({
      status: "failed",
      reason,
      file: "models/kokoro/onnx/model.onnx",
      message: "x",
      files: 6,
      totalBytes: 326_600_000,
      receivedBytes: 0,
      items: [ITEMS[1] as { id: string; bytes: number }],
    });

    it("says the connection is the problem when the host cannot be reached", () => {
      const view = modelsView(failed("offline"));
      expect(view?.tone).toBe("problem");
      expect(view?.headline).toBe("The voice models could not be downloaded");
      expect(view?.detail).toContain("could not reach the internet");
      expect(view?.progressLabel).toBe("327 MB still to download");
      expect(view?.items.map((i) => i.id)).toEqual(["kokoro"]);
    });

    it("says the server is the problem on a server error", () => {
      expect(modelsView(failed("server"))?.detail).toContain("server did not answer");
    });

    it("names the damaged file when a checksum was wrong", () => {
      expect(modelsView(failed("rejected"))?.detail).toContain("models/kokoro/onnx/model.onnx");
    });

    it("offers to try again or to go on without voice", () => {
      expect(modelsView(failed("offline"))?.actions).toEqual([
        { id: "retry", label: "Try again", primary: true },
        { id: "skip", label: "Continue without voice", primary: false },
      ]);
    });
  });

  it("confirms when the models are in place", () => {
    const view = modelsView({ status: "ready" });
    expect(view?.tone).toBe("done");
    expect(view?.headline).toBe("Voice is ready");
    expect(view?.actions).toEqual([{ id: "continue", label: "Continue", primary: true }]);
  });

  it("uses plain words: no file names except the one that was damaged, and no em dashes", () => {
    const states: ModelsState[] = [
      { status: "ready" },
      { status: "needed", files: 14, totalBytes: TOTAL, items: ITEMS },
      {
        status: "downloading",
        file: "models/kokoro/onnx/model.onnx",
        fileNumber: 1,
        fileCount: 14,
        receivedBytes: 1,
        totalBytes: TOTAL,
        items: ITEMS,
      },
    ];
    for (const state of states) {
      const view = modelsView(state);
      const text = [
        view?.headline,
        view?.detail,
        view?.progressLabel,
        ...(view?.actions.map((a) => a.label) ?? []),
      ].join(" ");
      expect(text).not.toContain("models/");
      expect(text).not.toContain("—");
    }
  });
});
