import type { ClaudeSetup } from "@hai/protocol";

export type ClaudeAction = "install" | "signin" | "recheck" | "skip" | "continue";

export interface ClaudeActionView {
  id: ClaudeAction;
  label: string;
  primary: boolean;
  disabled: boolean;
}

export interface PrerequisiteView {
  id: string;
  label: string;
  why: string;
  ok: boolean;
}

/** What the screen shows before it installs anything: the command, word for word, and where it comes from. */
export interface CommandView {
  command: string;
  source: string;
}

export interface ClaudeView {
  tone: "idle" | "busy" | "problem" | "done";
  headline: string;
  detail: string;
  /** Shown only before an install, so nothing runs that the user has not seen. */
  command: CommandView | null;
  /** What the installer printed so far, when an install is running or has failed. */
  output: string[];
  prerequisites: PrerequisiteView[];
  /** Something is running that has no measurable progress: the screen shows a moving bar. */
  working: boolean;
  /** The official instructions, offered whenever the user might prefer to do it by hand or an install failed. */
  manualUrl: string | null;
  actions: ClaudeActionView[];
}

const action = (id: ClaudeAction, label: string, primary = false, disabled = false): ClaudeActionView => ({
  id,
  label,
  primary,
  disabled,
});

/** A short status for a list row ("Ready", "Not installed"). */
export function claudeSummary(setup: ClaudeSetup | null): string {
  if (!setup) return "Checking";
  switch (setup.state.status) {
    case "checking":
      return "Checking";
    case "ready":
      return `Ready, version ${setup.state.version}`;
    case "missing":
      return "Not installed";
    case "broken":
      return "Did not start";
    case "signed-out":
      return "Not signed in";
    case "installing":
      return "Installing";
    case "install-failed":
      return "Install did not finish";
    case "signing-in":
      return "Waiting for sign-in";
  }
}

/**
 * What the first-run screen says and offers for Claude Code, from where it stands. Null while the app is still looking.
 * Plain words: this is what a first-time user reads, so it says what will happen before it happens. Installing needs
 * the user's press on a button that sits beside the exact command; signing in happens in Claude Code's own window.
 */
export function claudeView(setup: ClaudeSetup): ClaudeView | null {
  const { state, info } = setup;
  const prerequisites = setup.prerequisites.map(({ id, label, why, ok }) => ({ id, label, why, ok }));
  const unmet = prerequisites.filter((p) => !p.ok);
  const command: CommandView = { command: info.command, source: info.source };
  const base = { command: null, output: [], prerequisites: [], manualUrl: null, working: false };

  switch (state.status) {
    case "checking":
      return null;
    case "ready":
      return {
        ...base,
        tone: "done",
        headline: "Claude Code is ready",
        detail: `Version ${state.version} is installed and signed in. Your agent team can start work.`,
        actions: [action("continue", "Continue", true)],
      };
    case "missing":
      return {
        ...base,
        tone: "idle",
        headline: "Install Claude Code",
        detail:
          unmet.length > 0
            ? "The agent team runs on your own Claude Code. Install what is listed below first, then come back."
            : "The agent team runs on your own Claude Code, which is not on this computer yet. HAI can install it for you. You then sign in with your own Claude account.",
        command,
        prerequisites,
        manualUrl: info.instructionsUrl,
        actions: [
          action("install", "Install Claude Code", true, unmet.length > 0),
          action("recheck", "I installed it myself"),
          action("skip", "Skip for now"),
        ],
      };
    case "broken":
      return {
        ...base,
        tone: "problem",
        headline: "Claude Code did not start",
        detail:
          "It is installed but would not run. Installing it again usually fixes this. You can keep using HAI without the agent meanwhile.",
        command,
        prerequisites,
        manualUrl: info.instructionsUrl,
        actions: [
          action("install", "Install it again", true, unmet.length > 0),
          action("recheck", "Check again"),
          action("skip", "Skip for now"),
        ],
      };
    case "signed-out":
      return {
        ...base,
        tone: "idle",
        headline: "Sign in to Claude",
        detail:
          "Claude Code is installed. Sign in with your own Claude account in the window that opens. HAI never sees your login: it only asks Claude Code whether you are signed in.",
        actions: [
          action("signin", "Open the sign-in window", true),
          action("recheck", "I have signed in"),
          action("skip", "Skip for now"),
        ],
      };
    case "installing":
      return {
        ...base,
        tone: "busy",
        headline: "Installing Claude Code",
        detail: "This takes a minute or two. You can keep this window open while it works.",
        output: state.output,
        working: true,
        actions: [],
      };
    case "install-failed":
      return {
        ...base,
        tone: "problem",
        headline: "The installation did not finish",
        detail: `${state.message} You can try again, or install Claude Code yourself from its own instructions.`,
        output: state.output,
        manualUrl: info.instructionsUrl,
        actions: [action("install", "Try again", true), action("skip", "Skip for now")],
      };
    case "signing-in":
      return {
        ...base,
        tone: "busy",
        working: true,
        headline: "Waiting for you to sign in",
        detail:
          "Finish signing in in the window that opened. This screen moves on by itself when Claude Code says you are signed in.",
        actions: [
          action("recheck", "I have signed in", true),
          action("signin", "Open the window again"),
          action("skip", "Skip for now"),
        ],
      };
  }
}
