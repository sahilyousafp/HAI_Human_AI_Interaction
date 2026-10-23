import type { ModelsState } from "@hai/protocol";
import { describe, expect, it } from "vitest";
import { voiceAvailability, voicePillText } from "./availability.ts";

const ITEMS = [{ id: "kokoro", bytes: 326_600_000 }];
const downloading = (receivedBytes: number, totalBytes = 400_000_000): ModelsState => ({
  status: "downloading",
  file: "models/kokoro/onnx/model.onnx",
  fileNumber: 1,
  fileCount: 1,
  receivedBytes,
  totalBytes,
  items: ITEMS,
});

describe("voiceAvailability", () => {
  it("is ready in a browser, whatever the state, because the dev server serves the models", () => {
    expect(voiceAvailability(false, null)).toEqual({ kind: "ready" });
    expect(voiceAvailability(false, { status: "checking" })).toEqual({ kind: "ready" });
  });

  it("is getting ready in the desktop app until the models have been looked for", () => {
    expect(voiceAvailability(true, null)).toMatchObject({ kind: "preparing", percent: null });
    expect(voiceAvailability(true, { status: "checking" })).toMatchObject({
      kind: "preparing",
      percent: null,
    });
  });

  it("is ready when the models are in place", () => {
    expect(voiceAvailability(true, { status: "ready" })).toEqual({ kind: "ready" });
  });

  it("reports the download's progress as a whole percent that never passes 100", () => {
    expect(voiceAvailability(true, downloading(0))).toEqual({
      kind: "preparing",
      label: "Voice is downloading, 0%",
      percent: 0,
    });
    expect(voiceAvailability(true, downloading(123_456_789))).toMatchObject({ percent: 30 });
    expect(voiceAvailability(true, downloading(399_999_999))).toMatchObject({ percent: 99 });
    expect(voiceAvailability(true, downloading(900_000_000))).toMatchObject({ percent: 100 });
  });

  it("does not divide by an unknown size", () => {
    expect(voiceAvailability(true, downloading(5, 0))).toEqual({
      kind: "preparing",
      label: "Voice is downloading",
      percent: null,
    });
  });

  it("says the models are missing, with their size, when nothing is fetching them", () => {
    expect(
      voiceAvailability(true, { status: "needed", files: 14, totalBytes: 393_300_000, items: ITEMS }),
    ).toEqual({ kind: "missing", label: "Voice needs 393 MB of models", reason: "needed" });
  });

  it("says the download did not finish when it failed", () => {
    expect(
      voiceAvailability(true, {
        status: "failed",
        reason: "offline",
        file: "x",
        message: "x",
        files: 1,
        totalBytes: 1,
        receivedBytes: 0,
        items: ITEMS,
      }),
    ).toEqual({ kind: "missing", label: "The voice download did not finish", reason: "failed" });
  });
});

describe("voicePillText", () => {
  it("has nothing to say when voice is ready", () => {
    expect(voicePillText({ kind: "ready" })).toBeNull();
  });

  it("is short enough for the topbar", () => {
    expect(voicePillText(voiceAvailability(true, downloading(200_000_000)))).toBe("Voice downloading 50%");
    expect(voicePillText(voiceAvailability(true, null))).toBe("Voice getting ready");
    expect(voicePillText({ kind: "missing", label: "x", reason: "needed" })).toBe("Voice not downloaded");
    expect(voicePillText({ kind: "missing", label: "x", reason: "failed" })).toBe("Voice download failed");
  });
});
