/** An agent as names are matched against it. */
export interface Addressee {
  name: string;
  /** Other ways the name is heard or typed ("machi", "review or"). */
  aliases: string[];
}

export interface Addressed {
  /** The agent named, or null when the request names none. */
  agent: string | null;
  /** The request without the name. */
  text: string;
}

/** Fuzzy matching (one character of difference) only for words at least this long, so short words never match. */
const FUZZY_MIN = 4;

/** Lower case, letters and digits only: "Machi:" becomes "machi". */
const normalize = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** Levenshtein distance, stopping early once it is over 1. */
function withinOne(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** Whether a spoken or typed name (normalised words joined by a space) is this agent. */
function isNamed(candidate: string, agent: Addressee): boolean {
  const names = [agent.name, ...agent.aliases].map((n) =>
    n.toLowerCase().split(/\s+/).map(normalize).join(" "),
  );
  return names.some(
    (n) =>
      n === candidate || (candidate.length >= FUZZY_MIN && n.length >= FUZZY_MIN && withinOne(n, candidate)),
  );
}

/**
 * Who a request is for: an `@name` mention anywhere, or a name in its first one or two words ("Architect, add a
 * stair core", "Review or check the heights", as speech recognition splits it), ignoring case and punctuation and
 * allowing one character of difference ("Machi"). The name is taken out of the text.
 */
export function addressOf(text: string, agents: Addressee[]): Addressed {
  const mention = /(^|\s)@([\p{L}\p{N}-]+)/u.exec(text);
  if (mention) {
    const named = agents.find((a) => isNamed(normalize(mention[2] ?? ""), a));
    if (named) {
      const rest = `${text.slice(0, mention.index)}${mention[1]}${text.slice(mention.index + mention[0].length)}`;
      return { agent: named.name, text: rest.replace(/\s+/g, " ").trim() };
    }
  }
  const words = text.trim().split(/\s+/);
  const first = words[0] ?? "";
  // A name followed by punctuation ("Mochi, ...") is one word; otherwise the first two words may be one name.
  const ends = /[,:;.!?]$/.test(first);
  const tries = ends || words.length < 2 ? [1] : [2, 1];
  for (const count of tries) {
    const candidate = words.slice(0, count).map(normalize).join(" ");
    if (!candidate.replace(/\s/g, "")) continue;
    const named = agents.find((a) => isNamed(candidate, a));
    if (named) {
      const rest = words
        .slice(count)
        .join(" ")
        .replace(/^[\s,:;.!?-]+/, "");
      return { agent: named.name, text: rest };
    }
  }
  return { agent: null, text: text.trim() };
}
