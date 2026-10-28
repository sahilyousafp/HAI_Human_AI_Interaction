/** A reply longer than this many characters is shown cut, with a way to read the rest. */
export const REPLY_CLAMP = 320;

/**
 * The start of a long reply: whole sentences up to about `limit` characters (or whole words, when a sentence runs on).
 * `clipped` is false when the reply was short enough to show whole.
 */
export function clampReply(text: string, limit = REPLY_CLAMP): { shown: string; clipped: boolean } {
  if (text.length <= limit) return { shown: text, clipped: false };
  const head = text.slice(0, limit);
  const sentence = Math.max(
    head.lastIndexOf(". "),
    head.lastIndexOf("! "),
    head.lastIndexOf("? "),
    head.lastIndexOf("\n"),
  );
  const cut = sentence >= limit / 2 ? sentence + 1 : head.lastIndexOf(" ");
  const shown = (cut > 0 ? head.slice(0, cut) : head).trimEnd();
  return { shown: sentence >= limit / 2 ? shown : `${shown}…`, clipped: true };
}
