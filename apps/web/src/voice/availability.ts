import type { ModelsState } from "@hai/protocol";
import { formatBytes } from "../setup/models-view.ts";

/**
 * Whether the voice (speech to text and spoken replies) can be used right now. In a browser the models are always
 * served, so it is ready. In the desktop app they are downloaded after install, and until they are in place the voice
 * controls say so instead of failing when the models are asked for.
 */
export type VoiceAvailability =
  | { kind: "ready" }
  /** The models are being looked for or downloaded. `percent` is null while the size is not known yet. */
  | { kind: "preparing"; label: string; percent: number | null }
  /** The models are not on this computer and nothing is fetching them (not asked yet, stopped, or it failed). */
  | { kind: "missing"; label: string; reason: "needed" | "failed" };

export function voiceAvailability(inDesktop: boolean, state: ModelsState | null): VoiceAvailability {
  if (!inDesktop) return { kind: "ready" };
  if (!state || state.status === "checking")
    return { kind: "preparing", label: "Voice is getting ready", percent: null };
  switch (state.status) {
    case "ready":
      return { kind: "ready" };
    case "downloading": {
      const percent =
        state.totalBytes > 0
          ? Math.min(100, Math.floor((state.receivedBytes / state.totalBytes) * 100))
          : null;
      return {
        kind: "preparing",
        label: percent === null ? "Voice is downloading" : `Voice is downloading, ${percent}%`,
        percent,
      };
    }
    case "needed":
      return {
        kind: "missing",
        label: `Voice needs ${formatBytes(state.totalBytes)} of models`,
        reason: "needed",
      };
    case "failed":
      return { kind: "missing", label: "The voice download did not finish", reason: "failed" };
  }
}

/** A short form for the topbar pill, which has little room: "Voice 42%". */
export function voicePillText(availability: VoiceAvailability): string | null {
  switch (availability.kind) {
    case "ready":
      return null;
    case "preparing":
      return availability.percent === null
        ? "Voice getting ready"
        : `Voice downloading ${availability.percent}%`;
    case "missing":
      return availability.reason === "failed" ? "Voice download failed" : "Voice not downloaded";
  }
}
