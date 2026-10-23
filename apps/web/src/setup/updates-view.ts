import type { UpdateState } from "@hai/protocol";

export type UpdateAction = "check" | "download" | "restart";

export interface UpdatesView {
  /** One line for the row: where updating stands. */
  summary: string;
  /** A second line when there is more to say. */
  detail: string | null;
  /** The button to show, or null when there is nothing to press. */
  action: { id: UpdateAction; label: string; disabled: boolean } | null;
  /** 0 to 1 while downloading, else null. */
  progress: number | null;
  /** What the top bar says when there is something to act on, or null. */
  pill: string | null;
  tone: "idle" | "busy" | "attention" | "problem";
}

/** What Settings > Setup says and offers for updating, in plain words, from where updating stands. */
export function updatesView(state: UpdateState): UpdatesView {
  switch (state.status) {
    case "unavailable":
      return {
        summary: "Not available here",
        detail: "Updates come with the installed app. This copy is running from the source.",
        action: null,
        progress: null,
        pill: null,
        tone: "idle",
      };
    case "idle":
      return {
        summary: state.checkedAt ? "You have the latest version" : "Not checked yet",
        detail: null,
        action: { id: "check", label: "Check for updates", disabled: false },
        progress: null,
        pill: null,
        tone: "idle",
      };
    case "checking":
      return {
        summary: "Looking for updates",
        detail: null,
        action: { id: "check", label: "Checking", disabled: true },
        progress: null,
        pill: null,
        tone: "busy",
      };
    case "available":
      return {
        summary: `Version ${state.version} is available`,
        detail: `You have ${state.current}. Downloading does not change anything until you restart.`,
        action: { id: "download", label: "Download", disabled: false },
        progress: null,
        pill: `Update ${state.version} available`,
        tone: "attention",
      };
    case "downloading":
      return {
        summary: `Downloading version ${state.version}, ${state.percent}%`,
        detail: "HAI checks the file before it is used.",
        action: null,
        progress: Math.min(1, Math.max(0, state.percent / 100)),
        pill: `Downloading update ${state.percent}%`,
        tone: "busy",
      };
    case "ready":
      return {
        summary: `Version ${state.version} is ready`,
        detail: state.canRestart
          ? "HAI restarts, and the update is installed. Your work is kept."
          : "The agent is working. You can restart when it has finished.",
        action: state.canRestart
          ? { id: "restart", label: "Restart to update", disabled: false }
          : { id: "restart", label: "Restart when the agent finishes", disabled: true },
        progress: null,
        pill: state.canRestart ? "Restart to update" : "Update ready",
        tone: "attention",
      };
    case "error":
      return {
        summary: "Something went wrong",
        detail: state.message, // long, so it goes on its own line rather than beside the label
        action: { id: "check", label: "Try again", disabled: false },
        progress: null,
        pill: null,
        tone: "problem",
      };
  }
}
