import { describe, expect, it } from "vitest";
import { type PreparedSpeech, Speaker, type VoiceEngine } from "./speaker.ts";

/** A voice that records what it was asked to prepare and play; tests decide when synthesis and playback end. */
function fakeEngine() {
  const log: string[] = [];
  const speeches: Array<{ text: string; synthesised(): void; finished(): void; cancelled: boolean }> = [];
  const engine: VoiceEngine = {
    label: "fake voice",
    prepare(text): PreparedSpeech {
      log.push(`prepare ${text}`);
      let synthesised = () => {};
      let finished = () => {};
      const entry = {
        text,
        cancelled: false,
        synthesised: () => synthesised(),
        finished: () => finished(),
      };
      speeches.push(entry);
      return {
        ready: new Promise<void>((resolve) => {
          synthesised = resolve;
        }),
        play: () => {
          log.push(`play ${text}`);
          return new Promise<void>((resolve) => {
            finished = resolve;
          });
        },
        cancel: () => {
          entry.cancelled = true;
          log.push(`cancel ${text}`);
          finished();
        },
      };
    },
  };
  return { engine, log, speeches };
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe("Speaker", () => {
  it("first sentence starts early: it is spoken while the rest of the reply is still arriving", async () => {
    const { engine, log, speeches } = fakeEngine();
    const speaker = new Speaker(async () => engine);
    speaker.feed("t1", "Architect is on the stair core. Climate is run");
    await flush();
    speeches[0]?.synthesised();
    await flush();
    expect(log).toEqual(["prepare Architect is on the stair core.", "play Architect is on the stair core."]);
    expect(speaker.speaking).toBe(true);
    speaker.feed("t1", "ning the winter study.");
    speaker.end("t1");
    await flush();
    // The second sentence is prepared while the first plays, and played after it.
    expect(log.at(-1)).toBe("prepare Climate is running the winter study.");
    speeches[1]?.synthesised();
    speeches[0]?.finished();
    await flush();
    expect(log.at(-1)).toBe("play Climate is running the winter study.");
    speeches[1]?.finished();
    await flush();
    expect(speaker.speaking).toBe(false);
  });

  it("talking interrupts: speaking stops at once and nothing queued is said", async () => {
    const { engine, log, speeches } = fakeEngine();
    const speaker = new Speaker(async () => engine);
    speaker.feed("t1", "One. Two. Three.");
    speaker.end("t1");
    await flush();
    speeches[0]?.synthesised();
    await flush();
    speaker.stop();
    expect(speaker.speaking).toBe(false);
    speeches[1]?.synthesised();
    await flush();
    expect(log.filter((l) => l.startsWith("play"))).toEqual(["play One."]);
    expect(speeches.every((s) => s.cancelled)).toBe(true);
  });

  it("muted: the reply is not spoken at all", async () => {
    const { engine, log } = fakeEngine();
    const speaker = new Speaker(async () => engine);
    speaker.setMuted(true);
    speaker.feed("t1", "Architect is done. ");
    speaker.end("t1");
    await flush();
    expect(log).toEqual([]);
    speaker.setMuted(false);
    speaker.feed("t2", "Now I speak.");
    speaker.end("t2");
    await flush();
    expect(log).toEqual(["prepare Now I speak."]);
  });

  it("muting while speaking stops at once", async () => {
    const { engine, speeches } = fakeEngine();
    const speaker = new Speaker(async () => engine);
    speaker.feed("t1", "A long sentence. ");
    await flush();
    speeches[0]?.synthesised();
    await flush();
    speaker.setMuted(true);
    expect(speeches[0]?.cancelled).toBe(true);
    expect(speaker.speaking).toBe(false);
  });

  it("measures the time to the first sound of each reply", async () => {
    let now = 0;
    const { engine, speeches } = fakeEngine();
    const speaker = new Speaker(
      async () => engine,
      () => now,
    );
    speaker.feed("t1", "Hello there. ");
    await flush();
    now = 640;
    speeches[0]?.synthesised();
    await flush();
    expect(speaker.getSnapshot()).toEqual({ engine: "fake voice", firstAudio: [640], cutOff: null });
  });

  it("without any voice on the device nothing is spoken, and the settings say so", async () => {
    const speaker = new Speaker(async () => null);
    speaker.feed("t1", "Hello. ");
    await flush();
    expect(speaker.speaking).toBe(false);
    expect(speaker.getSnapshot().engine).toBe("none");
  });
});

describe("Speaker gives way to listening", () => {
  it("stops at once when the microphone opens, and what is left of that reply is not spoken", async () => {
    const { engine, log, speeches } = fakeEngine();
    const speaker = new Speaker(async () => engine);
    speaker.feed("t1", "The wall is done. The slab comes next. ");
    await flush();
    speeches[0]?.synthesised();
    await flush();
    expect(speaker.speaking).toBe(true);

    speaker.setListening(true);
    expect(speaker.speaking).toBe(false);
    expect(log).toContain("cancel The wall is done.");

    // The reply goes on streaming while the user talks, and after: none of it is spoken.
    speaker.feed("t1", "Then the stair core. ");
    speaker.setListening(false);
    speaker.feed("t1", "And the roof. ");
    speaker.end("t1");
    await flush();
    expect(log.filter((l) => l.startsWith("prepare"))).toEqual([
      "prepare The wall is done.",
      "prepare The slab comes next.",
    ]);
  });

  it("a reply that begins while the user is talking is left unspoken, and the next one is spoken", async () => {
    const { engine, log } = fakeEngine();
    const speaker = new Speaker(async () => engine);
    speaker.setListening(true);
    speaker.feed("t1", "Done. ");
    speaker.setListening(false);
    speaker.feed("t1", "Really done. ");
    speaker.end("t1");
    speaker.feed("t2", "A new answer. ");
    await flush();
    expect(log).toEqual(["prepare A new answer."]);
  });

  it("stop() alone also leaves the rest of the stopped reply unspoken", async () => {
    const { engine, log } = fakeEngine();
    const speaker = new Speaker(async () => engine);
    speaker.feed("t1", "First sentence. Second");
    await flush();
    speaker.stop();
    speaker.feed("t1", " sentence. Third sentence. ");
    speaker.end("t1");
    await flush();
    expect(log.filter((l) => l.startsWith("prepare"))).toEqual(["prepare First sentence."]);
  });
});

describe("Speaker speaks a reply's first sentences only", () => {
  it("speaks three sentences of a long reply and leaves the rest to read", async () => {
    const { engine, log } = fakeEngine();
    const speaker = new Speaker(async () => engine);
    speaker.feed("t1", "One. Two. Three. Four. Five. ");
    speaker.end("t1");
    await flush();
    expect(log.filter((l) => l.startsWith("prepare"))).toEqual([
      "prepare One.",
      "prepare Two.",
      "prepare Three.",
    ]);
  });
});

describe("Speaker reads on a reply the user talked over", () => {
  it("records where it was cut and reads the rest, from the cut sentence, when asked", async () => {
    const { engine, log, speeches } = fakeEngine();
    const speaker = new Speaker(async () => engine);
    speaker.feed("t1", "The wall is done. The slab comes next. ");
    await flush();
    speeches[0]?.synthesised();
    await flush();
    speeches[0]?.finished(); // the first sentence is said in full
    await flush();
    speeches[1]?.synthesised();
    await flush();
    expect(speaker.getSnapshot().cutOff).toBeNull();

    speaker.setListening(true);
    expect(speaker.getSnapshot().cutOff).toEqual({ turnId: "t1", words: 4 });
    // It goes on arriving while the user talks; none of it is spoken.
    speaker.feed("t1", "Then the stair core. ");
    speaker.end("t1");
    speaker.setListening(false);
    await flush();
    expect(log.filter((l) => l.startsWith("prepare"))).toEqual([
      "prepare The wall is done.",
      "prepare The slab comes next.",
    ]);

    speaker.resume();
    await flush();
    expect(log.filter((l) => l.startsWith("prepare")).slice(2)).toEqual([
      "prepare The slab comes next.",
      "prepare Then the stair core.",
    ]);
    expect(speaker.getSnapshot().cutOff).toBeNull();
  });

  it("a stop, or a new reply, forgets the cut", async () => {
    const { engine, speeches } = fakeEngine();
    const speaker = new Speaker(async () => engine);
    speaker.feed("t1", "A first sentence. ");
    await flush();
    speeches[0]?.synthesised();
    await flush();
    speaker.setListening(true);
    expect(speaker.getSnapshot().cutOff).not.toBeNull();
    speaker.setListening(false);
    speaker.feed("t2", "A fresh answer. ");
    await flush();
    expect(speaker.getSnapshot().cutOff).toBeNull();
    speaker.resume(); // nothing to read on
  });

  it("does not read on while the user is still talking", async () => {
    const { engine, log, speeches } = fakeEngine();
    const speaker = new Speaker(async () => engine);
    speaker.feed("t1", "Sentence one. Sentence two. ");
    await flush();
    speeches[0]?.synthesised();
    await flush();
    speaker.setListening(true);
    speaker.resume();
    await flush();
    expect(log.filter((l) => l.startsWith("prepare"))).toHaveLength(2);
    expect(speaker.getSnapshot().cutOff).not.toBeNull();
  });
});
