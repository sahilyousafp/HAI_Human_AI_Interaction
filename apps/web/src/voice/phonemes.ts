import { phonemize } from "phonemize";

const VOWELS = "aeiouæɑɒɔəɚɛɜɪʊʌᵻɐ";
const STRESS_BEFORE_VOWEL = new RegExp(`([ˈˌ])([^${VOWELS} ]*)`, "g");

/**
 * Adapts `phonemize` output to Kokoro's phoneme vocabulary (docs/decisions.md): stress marks move from the start of
 * the syllable to just before its vowel, as espeak and misaki write them, and the sounds Kokoro has no symbol for
 * map to the nearest it has (dark l to l, the r-coloured vowel to ɜɹ, r to ɹ).
 */
export function kokoroPhonemes(ipa: string): string {
  return ipa.replace(/ɫ/g, "l").replace(/ɝ/g, "ɜɹ").replace(/r/g, "ɹ").replace(STRESS_BEFORE_VOWEL, "$2$1");
}

/** Whether a sentence has anything to say (a letter or digit). */
const hasWords = (text: string) => /[\p{L}\p{N}]/u.test(text);

/** English text as Kokoro phonemes. */
export const textToPhonemes = (text: string) => kokoroPhonemes(phonemize(text));

/** What is read aloud of a reply: no code, links or Markdown marks. */
export function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?(```|$)/g, " ") // code blocks, even unfinished
    .replace(/`[^`]*`/g, " ") // inline code
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links read as their text
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/^\s*[-*+]\s+/gm, "") // list bullets
    .replace(/^\s*#+\s*/gm, "") // headings
    .replace(/[*_~>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Splits a reply into sentences as it streams in: `push` returns the sentences completed so far, `flush` the rest
 * when the reply ends. A sentence ends at ., ! or ? followed by a space, or at a line break; "3.5 m" and "e.g." stay
 * whole. Code blocks are held back until they close and then dropped.
 */
export class SentenceSplitter {
  private buffer = "";

  push(delta: string): string[] {
    // Closed code blocks are never spoken; an open one is held back until it closes.
    this.buffer = (this.buffer + delta).replace(/```[\s\S]*?```/g, " ");
    const sentences: string[] = [];
    for (;;) {
      const fences = this.buffer.match(/```/g)?.length ?? 0;
      const searchable =
        fences % 2 === 1 ? this.buffer.slice(0, this.buffer.lastIndexOf("```")) : this.buffer;
      const end = /(?<![0-9]\.[0-9]*|\b(?:e\.g|i\.e|etc|mr|mrs|dr|vs))([.!?]+)(?=\s)|\n+/i.exec(searchable);
      if (!end) break;
      const cut = end.index + end[0].length;
      const sentence = speakable(this.buffer.slice(0, cut));
      this.buffer = this.buffer.slice(cut);
      if (hasWords(sentence)) sentences.push(sentence);
    }
    return sentences;
  }

  flush(): string[] {
    const rest = speakable(this.buffer);
    this.buffer = "";
    return hasWords(rest) ? [rest] : [];
  }
}
