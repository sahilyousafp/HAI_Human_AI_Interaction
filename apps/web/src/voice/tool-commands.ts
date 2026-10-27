import { normalize, withinOne } from "../agent/addressing.ts";
import { spokenNames } from "../tools/registry.ts";
import type { Tool } from "../tools/types.ts";

/** One letter of difference is allowed only for names at least this long (letters, without spaces). */
export const TOOL_FUZZY_MIN = 5;
/** Words around a tool's name that do not change which tool is meant: "use the wall tool". */
const LEADING = new Set(["use", "tool", "the"]);
const TRAILING = new Set(["tool"]);

/** A transcript as words to compare: lower case, letters and digits only, without the filler words around a name. */
function words(text: string): string {
  const all = text.trim().split(/\s+/).map(normalize).filter(Boolean);
  let start = 0;
  let end = all.length;
  while (start < end && LEADING.has(all[start] ?? "")) start++;
  while (end > start && TRAILING.has(all[end - 1] ?? "")) end--;
  return all.slice(start, end).join(" ");
}

/**
 * The tool a transcript names when it is nothing but that tool's spoken name ("measure", "sketch area", "use the wall
 * tool"), or null. Exact names win; otherwise one letter of difference is allowed for names of five letters or more,
 * as long as only one tool comes that close. Anything longer than a name ("measure the distance between these") is a
 * request for the agent, so it never matches.
 */
export function toolNamed(text: string, tools: Tool[]): Tool | null {
  const said = words(text);
  if (!said) return null;
  const names = tools.flatMap((tool) => spokenNames(tool).map((name) => ({ tool, name: words(name) })));
  const exact = names.find((n) => n.name === said);
  if (exact) return exact.tool;
  const letters = said.replace(/\s/g, "").length;
  if (letters < TOOL_FUZZY_MIN) return null;
  const close = new Set(
    names
      .filter((n) => n.name.replace(/\s/g, "").length >= TOOL_FUZZY_MIN && withinOne(n.name, said))
      .map((n) => n.tool),
  );
  return close.size === 1 ? ([...close][0] ?? null) : null;
}
