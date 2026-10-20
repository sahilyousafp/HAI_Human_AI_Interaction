import { describe, expect, it } from "vitest";
import { kokoroPhonemes, SentenceSplitter, speakable, textToPhonemes } from "./phonemes.ts";

describe("phonemes for Kokoro", () => {
  it("moves stress marks from the start of the syllable to before its vowel", () => {
    expect(kokoroPhonemes("ˈmoʊtʃi")).toBe("mˈoʊtʃi");
    expect(kokoroPhonemes("ˌɑɹkɪˈtɛkt")).toBe("ˌɑɹkɪtˈɛkt");
    expect(kokoroPhonemes("ˈstɛɹ")).toBe("stˈɛɹ");
  });

  it("maps sounds Kokoro has no symbol for: dark l, r-coloured vowel, r", () => {
    expect(kokoroPhonemes("ɫ")).toBe("l");
    expect(kokoroPhonemes("ɝ")).toBe("ɜɹ");
    expect(kokoroPhonemes("r")).toBe("ɹ");
  });

  it("English text comes out with no unsupported symbols", () => {
    const phonemes = textToPhonemes("Architect is working on the stair core.");
    expect(phonemes).not.toMatch(/[ɫɝr]/);
    expect(phonemes).toMatch(/kɔɹ|kɔːɹ|koʊɹ/);
  });
});

describe("what is spoken", () => {
  it("drops code, links and Markdown marks", () => {
    expect(speakable("**Done.** See `create_elements` and [the docs](https://x.y/z).")).toBe(
      "Done. See and the docs.",
    );
    expect(speakable('Here:\n```json\n{"a": 1}\n```\nThat is all.')).toBe("Here: That is all.");
    expect(speakable("- Architect: core\n- Climate: shadows")).toBe("Architect: core Climate: shadows");
  });

  it("first sentence starts early: a sentence is complete before the reply is", () => {
    const splitter = new SentenceSplitter();
    expect(splitter.push("Architect is on the stair ")).toEqual([]);
    expect(splitter.push("core. Climate is run")).toEqual(["Architect is on the stair core."]);
    expect(splitter.push("ning the winter study.")).toEqual([]); // no space yet after the full stop
    expect(splitter.flush()).toEqual(["Climate is running the winter study."]);
  });

  it("numbers and abbreviations do not end a sentence", () => {
    const splitter = new SentenceSplitter();
    expect(splitter.push("Three floors of 3.5 m, e.g. offices. Next")).toEqual([
      "Three floors of 3.5 m, e.g. offices.",
    ]);
  });

  it("a line break ends a sentence, and code blocks are held back and dropped", () => {
    const splitter = new SentenceSplitter();
    expect(splitter.push("Done\n```ts\nconst a = 1;\n")).toEqual(["Done"]);
    expect(splitter.push("```\nAll set! Bye")).toEqual(["All set!"]);
    expect(splitter.flush()).toEqual(["Bye"]);
  });
});
