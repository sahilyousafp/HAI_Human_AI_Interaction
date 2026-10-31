/**
 * Putting right what the speech model mishears, with the app's own word sets as the reference.
 *
 * A model writes what it thinks it heard: "colon" for "column", "undue" for "undo", "for" for "four", "scatch" for
 * "sketch". The reference is the standard word sets the app already has (the words its command grammar reads, the
 * spoken names of its tools): a heard word that is not one of them is compared, by how it sounds, with the ones that are,
 * and a transcript is only changed when the change makes it something the app understands in full. Words are compared
 * as sounds, from the pronouncing dictionary of the `phonemize` library, so spelling does not matter.
 */

/** A word as sounds: the IPA string for it. */
export type Pronounce = (word: string) => string;

const VOWELS = new Set("aeiouæɑɒɔəɚɛɜɪʊʌᵻɐ");
/** Sounds made the same way, so a model easily takes one for another. */
const FAMILIES = ["pbtdkgʔ", "fvszʃʒθðh", "mnŋ", "lɹ", "wj"];
/** The same sound with and without voice. */
const VOICING = ["pb", "td", "kg", "fv", "sz", "ʃʒ", "θð"];

const family = (sound: string) => FAMILIES.findIndex((f) => f.includes(sound));

/** The sounds of an IPA string: no stress or length marks, the dark l as l and the r-coloured vowel as vowel and r. */
function sounds(ipa: string): string[] {
  return [
    ...ipa
      .replace(/[ˈˌː\s]/g, "")
      .replace(/ɫ/g, "l")
      .replace(/ɝ/g, "ɜɹ")
      .replace(/ɚ/g, "əɹ"),
  ];
}

/** How far one sound is from another: 0 when they are the same, 1 when nothing is alike. */
function swap(a: string, b: string): number {
  if (a === b) return 0;
  const vowels = VOWELS.has(a) && VOWELS.has(b);
  if (vowels) return a === "ə" || b === "ə" ? 0.3 : 0.4;
  if (VOWELS.has(a) || VOWELS.has(b)) return 1;
  if (VOICING.some((pair) => pair.includes(a) && pair.includes(b))) return 0.3;
  const fa = family(a);
  return fa >= 0 && fa === family(b) ? 0.55 : 1;
}

/** What it costs to hear a sound that is not there, or miss one that is: a vowel is easier to lose than a consonant. */
const gap = (sound: string) => (VOWELS.has(sound) ? 0.5 : 0.8);

/** How different two pronunciations sound: 0 for the same sounds, about 1 for nothing alike. */
export function soundDistance(a: string, b: string): number {
  const x = sounds(a);
  const y = sounds(b);
  let row = [0];
  for (const sound of y) row.push((row.at(-1) ?? 0) + gap(sound));
  for (const left of x) {
    const next = [(row[0] ?? 0) + gap(left)];
    y.forEach((right, j) => {
      next.push(
        Math.min(
          (row[j] ?? 0) + swap(left, right),
          (row[j + 1] ?? 0) + gap(left),
          (next[j] ?? 0) + gap(right),
        ),
      );
    });
    row = next;
  }
  return (row.at(-1) ?? 0) / Math.max(x.length, y.length, 1);
}

/** A heard word may be taken for a reference word this close in sound (the mishearings measured are under 0.25). */
export const NEAR = 0.28;
/** A word this short is only put right when it sounds all but the same ("to" and "two", "for" and "four", "won" and "one"). */
const SHORT = 3;
const NEAR_SHORT = 0.15;
/**
 * How many words of one transcript may be put right: one (`correct` tries one swap at a time). Two swaps can turn nearly any sentence into a command ("what
 * would you like to move" came out as "would would you like to remove"); every mishearing measured is one word. And how
 * many choices each word has: a search that stays small.
 */
const MOST_CHOICES = 3;

export interface Heard {
  /** The reference words this word could be, nearest first. */
  choices: string[];
}

/** What each pronouncing function has been asked for, so a word is only looked up once however many lexicons are made. */
const PRONOUNCED = new WeakMap<Pronounce, Map<string, string>>();

/** The reference word sets, ready to compare with what was heard. */
export class Lexicon {
  private readonly sounds: Map<string, string>;
  private readonly words: string[];

  constructor(
    reference: Iterable<string>,
    private readonly pronounce: Pronounce,
  ) {
    this.words = [...new Set(reference)].filter((w) => /^[a-z]+$/.test(w));
    this.sounds = PRONOUNCED.get(pronounce) ?? new Map();
    PRONOUNCED.set(pronounce, this.sounds);
  }

  private soundOf(word: string): string {
    let known = this.sounds.get(word);
    if (known === undefined) {
      known = this.pronounce(word);
      this.sounds.set(word, known);
    }
    return known;
  }

  /**
   * The reference words a heard word could be, nearest first, without the word itself. A short word only has the ones it
   * sounds all but exactly like (and they may be short too); a longer one those within `NEAR`, and longer than that.
   */
  couldBe(heard: string): string[] {
    if (!/^[a-z]+$/.test(heard)) return [];
    const said = this.soundOf(heard);
    const limit = heard.length <= SHORT ? NEAR_SHORT : NEAR;
    return this.words
      .filter((word) => word !== heard && (word.length > SHORT || limit === NEAR_SHORT))
      .map((word) => ({ word, distance: soundDistance(said, this.soundOf(word)) }))
      .filter((c) => c.distance <= limit)
      .sort((a, b) => a.distance - b.distance || a.word.length - b.word.length)
      .slice(0, MOST_CHOICES)
      .map((c) => c.word);
  }

  /**
   * The transcript as the app understands it, if some of its words sound like reference words and putting those right
   * makes `understood` say yes; otherwise null. Fewer changes are tried before more, and the transcript itself is not
   * tried again.
   */
  correct(words: string[], understood: (text: string) => boolean): string | null {
    // One word at a time, left to right, nearest choice first: `MOST_CHANGED` is one (see above).
    for (const [index, word] of words.entries()) {
      for (const choice of this.couldBe(word)) {
        const text = words.map((w, i) => (i === index ? choice : w)).join(" ");
        if (understood(text)) return text;
      }
    }
    return null;
  }
}
