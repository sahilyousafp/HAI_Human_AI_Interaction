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
    expect(speaker.getSnapshot()).toEqual({ engine: "fake voice", firstAudio: [640] });
  });

  it("without any voice on the device nothing is spoken, and the settings say so", async () => {
    const speaker = new Speaker(async () => null);
    speaker.feed("t1", "Hello. ");
    await flush();
    expect(speaker.speaking).toBe(false);
    expect(speaker.getSnapshot().engine).toBe("none");
  });
});
