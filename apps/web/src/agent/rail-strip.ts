import type { StripLayout } from "@hai/protocol";

/** What the collapsed strip has to show, as the panel knows it now. */
export interface StripFacts {
  /** Requests, questions and plans waiting for the user. */
  waiting: number;
  /** The last line of the agent's latest reply, or null when it has said nothing. */
  lastLine: string | null;
  /** How many agents there are besides the lead, and how many of them are working or waiting. */
  teamSize: number;
  teamActive: number;
}

/** One thing drawn in the strip, top to bottom (the microphone is last, at the foot). */
export type StripPart =
  /** `loud`: the count takes over the strip, in the alert colour, with what it is. */
  | { kind: "waiting"; loud: boolean }
  /** `compact`: the dot without its label. */
  | { kind: "state"; compact: boolean }
  /** `compact`: only the agents that are working or waiting. */
  | { kind: "team"; compact: boolean }
  | { kind: "name" }
  | { kind: "lastLine" }
  | { kind: "mic" };

/** How much room each thing takes in the strip, pixels, with the gap before it. */
const GAP = 12;
export const STRIP_SIZE = {
  waiting: 24,
  waitingLoud: 128,
  stateFull: 92,
  stateCompact: 12,
  name: 88,
  lastLine: 96,
  teamDot: 28,
  mic: 40,
} as const;

/**
 * What the collapsed strip shows in `room` pixels (what is left under the chevron): the user's items in their priority
 * order, each in full or, where it has one, in a smaller form when the room is short; the first one that does not fit
 * ends the list, so the lower ones drop first. A request waiting for the user, when it is listed first, takes over the
 * strip: it is drawn large with the alert colour and only the microphone stays beside it. The microphone, if listed, is
 * kept for last and sits at the foot.
 */
export function planStrip(
  layout: StripLayout,
  facts: StripFacts,
  room: number,
): { parts: StripPart[]; alert: boolean } {
  const wantsMic = layout.items.includes("mic");
  const reserved = wantsMic ? STRIP_SIZE.mic + GAP : 0;
  const parts: StripPart[] = [];
  let left = room - reserved;
  const take = (size: number): boolean => {
    if (size + GAP > left) return false;
    left -= size + GAP;
    return true;
  };

  const loud = layout.items[0] === "waiting" && facts.waiting > 0;
  if (loud) {
    if (take(STRIP_SIZE.waitingLoud)) parts.push({ kind: "waiting", loud: true });
    else if (take(STRIP_SIZE.waiting)) parts.push({ kind: "waiting", loud: false });
  } else {
    for (const item of layout.items) {
      if (item === "mic") continue;
      const part = fit(item, facts, take);
      if (part === "skip") continue;
      if (part === null) break;
      parts.push(part);
    }
  }
  if (wantsMic) parts.push({ kind: "mic" });
  return { parts, alert: loud };
}

/** One item in the room that is left: its part, "skip" when it has nothing to show, or null when it does not fit. */
function fit(
  item: Exclude<StripLayout["items"][number], "mic">,
  facts: StripFacts,
  take: (size: number) => boolean,
): StripPart | "skip" | null {
  switch (item) {
    case "waiting":
      if (facts.waiting === 0) return "skip";
      return take(STRIP_SIZE.waiting) ? { kind: "waiting", loud: false } : null;
    case "state":
      if (take(STRIP_SIZE.stateFull)) return { kind: "state", compact: false };
      return take(STRIP_SIZE.stateCompact) ? { kind: "state", compact: true } : null;
    case "team":
      if (facts.teamSize === 0) return "skip";
      if (take(STRIP_SIZE.teamDot * facts.teamSize)) return { kind: "team", compact: false };
      if (facts.teamActive === 0) return "skip";
      return take(STRIP_SIZE.teamDot * facts.teamActive) ? { kind: "team", compact: true } : null;
    case "name":
      return take(STRIP_SIZE.name) ? { kind: "name" } : null;
    case "lastLine":
      if (!facts.lastLine) return "skip";
      return take(STRIP_SIZE.lastLine) ? { kind: "lastLine" } : null;
  }
}
