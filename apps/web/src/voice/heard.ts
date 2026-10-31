import { phonemize } from "phonemize";
import { COMMAND_VOCABULARY, parseCommand, wordsOf } from "../commands/grammar.ts";
import { spokenNames } from "../tools/registry.ts";
import type { Tool } from "../tools/types.ts";
import { Lexicon } from "./lexicon.ts";
import { toolNamed } from "./tool-commands.ts";

/**
 * A transcript the app does not understand, put right: words that sound like the app's own words (those its command
 * grammar reads and the spoken names of its tools) are swapped for them, and the result is only given back when the app
 * understands it in full: a tool's name, or a command. Null when nothing needs putting right or nothing helps.
 */
export function heardAs(text: string, tools: Tool[]): string | null {
  const toolWords = tools.flatMap((tool) => spokenNames(tool).flatMap((name) => name.split(" ")));
  const lexicon = new Lexicon([...COMMAND_VOCABULARY, ...toolWords], phonemize);
  return lexicon.correct(
    wordsOf(text),
    (said) => toolNamed(said, tools) !== null || parseCommand(said) !== null,
  );
}
