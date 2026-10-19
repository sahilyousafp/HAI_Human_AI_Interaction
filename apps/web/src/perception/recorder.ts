import type { TrackingFrame } from "@aex/protocol";

/**
 * Dev-only recorder of smoothed tracking frames (exactly what the gesture recognisers consume).
 * Used to build test fixtures from recorded clips. Frames contain landmarks only, never pixels.
 */
export class LandmarkRecorder {
  private frames: TrackingFrame[] | null = null;

  get active(): boolean {
    return this.frames !== null;
  }

  start(): void {
    this.frames = [];
  }

  push(frame: TrackingFrame): void {
    this.frames?.push(frame);
  }

  /** Stops recording and returns the frames captured since start(). */
  stop(): TrackingFrame[] {
    const frames = this.frames ?? [];
    this.frames = null;
    return frames;
  }
}

/** Saves recorded frames as a JSON file through a temporary download link. */
export function downloadFrames(frames: TrackingFrame[]): void {
  const blob = new Blob([JSON.stringify(frames)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `aex-landmarks-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

declare global {
  interface Window {
    /** Dev builds only: lets scripts record fixtures (see scripts/export-landmarks.mjs). */
    __AEX_RECORDER__?: LandmarkRecorder;
  }
}
