import type { ModelItem, ModelsState } from "@hai/protocol";

/** "7.8 MB", "67 MB", "393 MB", "1.2 GB": decimal units, as the operating system and the download sites count. */
export function formatBytes(bytes: number): string {
  const mb = bytes / 1e6;
  if (mb >= 1000) return `${(mb / 1000).toFixed(1)} GB`;
  if (mb >= 10) return `${Math.round(mb)} MB`;
  if (mb >= 0.1) return `${mb.toFixed(1)} MB`;
  return "under 1 MB";
}

/** What the screen calls each folder of model files. */
const ITEM_COPY: Record<string, { title: string; detail: string }> = {
  "moonshine-base": { title: "Speech to text", detail: "Understands what you say" },
  kokoro: { title: "Spoken replies", detail: "Reads the agent's answers aloud" },
};

export type ModelsAction = "download" | "retry" | "continue" | "skip" | "cancel";

export interface ModelsActionView {
  id: ModelsAction;
  label: string;
  primary: boolean;
}

export interface ModelsItemView {
  id: string;
  title: string;
  detail: string;
  size: string;
  state: "waiting" | "active" | "done";
}

export interface ModelsView {
  tone: "idle" | "busy" | "problem" | "done";
  headline: string;
  detail: string;
  /** 0 to 1 while downloading, else null. */
  progress: number | null;
  progressLabel: string | null;
  items: ModelsItemView[];
  actions: ModelsActionView[];
}

function itemViews(items: readonly ModelItem[], receivedBytes: number | null): ModelsItemView[] {
  let end = 0;
  let activeFound = false;
  return items.map((item) => {
    end += item.bytes;
    const copy = ITEM_COPY[item.id] ?? { title: item.id, detail: "" };
    let state: ModelsItemView["state"] = "waiting";
    if (receivedBytes !== null) {
      if (receivedBytes >= end) state = "done";
      else if (!activeFound) {
        state = "active";
        activeFound = true;
      }
    }
    return { id: item.id, ...copy, size: formatBytes(item.bytes), state };
  });
}

const FAILURE_DETAIL = {
  offline: "HAI could not reach the internet. Check your connection and try again.",
  server: "The download server did not answer properly. Try again in a few minutes.",
} as const;

/**
 * What the first-run screen says and offers for the voice models, from their state. Null while the app is still
 * looking at what is on the disk. Plain words: this is what a first-time user reads.
 */
export function modelsView(state: ModelsState): ModelsView | null {
  switch (state.status) {
    case "checking":
      return null;
    case "ready":
      return {
        tone: "done",
        headline: "Voice is ready",
        detail:
          "The voice models are installed on this computer. You can speak to the agent and hear its answers.",
        progress: null,
        progressLabel: null,
        items: [],
        actions: [{ id: "continue", label: "Continue", primary: true }],
      };
    case "needed":
      return {
        tone: "idle",
        headline: "Download the voice models",
        detail: `Voice needs about ${formatBytes(state.totalBytes)}, downloaded once and kept on this computer. Camera and hands work without it.`,
        progress: null,
        progressLabel: null,
        items: itemViews(state.items, null),
        actions: [
          { id: "download", label: "Download", primary: true },
          { id: "skip", label: "Continue without voice", primary: false },
        ],
      };
    case "downloading":
      return {
        tone: "busy",
        headline: "Downloading the voice models",
        detail: "You can start using HAI now. Voice turns on by itself when this finishes.",
        progress: state.totalBytes > 0 ? Math.min(1, state.receivedBytes / state.totalBytes) : null,
        progressLabel: `${formatBytes(state.receivedBytes)} of ${formatBytes(state.totalBytes)}`,
        items: itemViews(state.items, state.receivedBytes),
        actions: [
          { id: "continue", label: "Continue", primary: true },
          { id: "cancel", label: "Stop download", primary: false },
        ],
      };
    case "failed": {
      const reason = state.reason;
      return {
        tone: "problem",
        headline: "The voice models could not be downloaded",
        detail:
          reason === "rejected"
            ? `A downloaded file was damaged and was thrown away (${state.file}). Try again.`
            : FAILURE_DETAIL[reason],
        progress: null,
        progressLabel: `${formatBytes(state.totalBytes)} still to download`,
        items: itemViews(state.items, null),
        actions: [
          { id: "retry", label: "Try again", primary: true },
          { id: "skip", label: "Continue without voice", primary: false },
        ],
      };
    }
  }
}
