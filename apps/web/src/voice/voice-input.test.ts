import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestContext } from "./utterance-context.ts";
import { VOICE } from "./voice-config.ts";
import { type ListenerEvents, micError, VoiceInput } from "./voice-input.ts";

function setup(options: { failWith?: string; transcript?: string } = {}) {
  let events: ListenerEvents | null = null;
  const mic = { open: false, finished: 0 };
  const sent: Array<{ text: string; context: RequestContext }> = [];
  const voice = new VoiceInput({
    listen: async (e) => {
      if (options.failWith) throw new DOMException("x", options.failWith);
      events = e;
      mic.open = true;
      return {
        finish: () => {
          mic.finished++;
          e.speechEnd({ audio: new Float32Array(16_000) });
        },
        cancel: () => {
          mic.open = false;
        },
      };
    },
    transcribe: async () => options.transcript ?? "make this wall 300 thick",
    send: (text, context) => {
      sent.push({ text, context });
      return true;
    },
    context: () => ({ references: [], selection: [], groundPoint: null }),
  });
  /** Speech starts and ends; the (async) transcription settles without moving the fake clock. */
  const speak = async () => {
    events?.speechStart();
    events?.speechEnd({ audio: new Float32Array(16_000) });
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  return { voice, mic, sent, speak, events: () => events };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("VoiceInput", () => {
  it("does nothing with the microphone until asked", () => {
    const { voice, mic } = setup();
    expect(voice.getSnapshot()).toEqual({ phase: "off" });
    expect(voice.micOn).toBe(false);
    expect(mic.open).toBe(false);
  });

  it("listens, transcribes when speech ends, stops the microphone, and sends after 1.5 s", async () => {
    const { voice, mic, sent, speak } = setup();
    await voice.start();
    expect(voice.getSnapshot()).toMatchObject({ phase: "listening", speaking: false });
    expect(mic.open).toBe(true);
    await speak();
    expect(mic.open).toBe(false); // released as soon as the utterance ended
    expect(voice.getSnapshot()).toMatchObject({ phase: "review", text: "make this wall 300 thick" });
    vi.advanceTimersByTime(VOICE.sendDelayMs - 1);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(sent.map((s) => s.text)).toEqual(["make this wall 300 thick"]);
    expect(voice.getSnapshot()).toMatchObject({ phase: "sent" });
  });

  it("nod sends immediately; nothing is sent twice", async () => {
    const { voice, sent, speak } = setup();
    await voice.start();
    await speak();
    voice.confirm();
    vi.advanceTimersByTime(5000);
    expect(sent).toHaveLength(1);
  });

  it("shake discards: nothing is sent and the transcript is marked discarded", async () => {
    const { voice, sent, speak } = setup();
    await voice.start();
    await speak();
    voice.discard();
    vi.advanceTimersByTime(5000);
    expect(sent).toEqual([]);
    expect(voice.getSnapshot()).toEqual({ phase: "discarded", text: "make this wall 300 thick" });
  });

  it("editing the transcript holds it until the user sends it", async () => {
    const { voice, sent, speak } = setup();
    await voice.start();
    await speak();
    voice.edit("make this wall 250 thick");
    vi.advanceTimersByTime(5000);
    expect(sent).toEqual([]);
    voice.confirm();
    expect(sent.map((s) => s.text)).toEqual(["make this wall 250 thick"]);
  });

  it("an utterance is cut at 20 s, and listening without speech stops after 8 s", async () => {
    const long = setup();
    await long.voice.start();
    long.events()?.speechStart();
    vi.advanceTimersByTime(VOICE.maxUtteranceMs);
    expect(long.mic.finished).toBe(1);

    const quiet = setup();
    await quiet.voice.start();
    vi.advanceTimersByTime(VOICE.noSpeechMs);
    expect(quiet.voice.getSnapshot()).toEqual({ phase: "off" });
    expect(quiet.mic.open).toBe(false);
  });

  it("stopping while the microphone is still opening cancels, and releases it once it opens", async () => {
    const { voice, mic } = setup();
    const opening = voice.start();
    voice.finish();
    expect(voice.getSnapshot()).toEqual({ phase: "off" });
    await opening;
    expect(mic.open).toBe(false);
    expect(voice.getSnapshot()).toEqual({ phase: "off" });
  });

  it("microphone denied: says how to re-enable it", async () => {
    const { voice } = setup({ failWith: "NotAllowedError" });
    await voice.start();
    expect(voice.getSnapshot()).toMatchObject({ phase: "error", error: "denied" });
    expect((voice.getSnapshot() as { message: string }).message).toMatch(/address bar.*type/);
  });

  it("an empty transcript sends nothing", async () => {
    const { voice, sent, speak } = setup({ transcript: "  " });
    await voice.start();
    await speak();
    expect(voice.getSnapshot()).toEqual({ phase: "off" });
    expect(sent).toEqual([]);
  });

  it("maps getUserMedia errors to recovery messages", () => {
    expect(micError(new DOMException("", "NotAllowedError"))).toBe("denied");
    expect(micError(new DOMException("", "NotFoundError"))).toBe("not-found");
    expect(micError(new Error("boom"))).toBe("failed");
  });
});

describe("listening for names", () => {
  /** A fake microphone that can be opened more than once (listening for names, then a spoken request). */
  function names(transcripts: string[]) {
    const opened: Array<{ events: ListenerEvents; open: boolean }> = [];
    const sent: string[] = [];
    const voice = new VoiceInput({
      listen: async (events) => {
        const mic = { events, open: true };
        opened.push(mic);
        return {
          finish: () => events.speechEnd({ audio: new Float32Array(16_000) }),
          cancel: () => {
            mic.open = false;
          },
        };
      },
      transcribe: async () => transcripts.shift() ?? "",
      send: (text) => {
        sent.push(text);
        return true;
      },
      context: () => ({ references: [], selection: [], groundPoint: null }),
      isNamed: (text) => /^(mochi|architect)\b/i.test(text),
    });
    const flush = async () => {
      for (let i = 0; i < 6; i++) await Promise.resolve();
    };
    const current = () => opened.at(-1);
    const say = async () => {
      current()?.events.speechStart();
      current()?.events.speechEnd({ audio: new Float32Array(16_000) });
      await flush();
    };
    const openNow = () => opened.filter((m) => m.open).length;
    return { voice, sent, flush, say, opened, openNow };
  }

  it("off by default: nothing listens", () => {
    const { voice, opened } = names([]);
    expect(voice.listeningForNames).toBe(false);
    expect(voice.micState).toBe("off");
    expect(opened).toEqual([]);
  });

  it("named utterance becomes a request: it goes to review and the microphone stays open", async () => {
    const { voice, sent, flush, say, openNow } = names(["Mochi, what is everyone doing?"]);
    voice.setListenForNames(true);
    await flush();
    expect(voice.micState).toBe("names");
    expect(voice.getSnapshot()).toEqual({ phase: "names", speaking: false });
    await say();
    expect(voice.getSnapshot()).toMatchObject({ phase: "review", text: "Mochi, what is everyone doing?" });
    vi.advanceTimersByTime(VOICE.sendDelayMs);
    expect(sent).toEqual(["Mochi, what is everyone doing?"]);
    expect(openNow()).toBe(1);
    expect(voice.micState).toBe("names");
  });

  it("other speech is ignored: nothing is shown or sent, and listening goes on", async () => {
    const { voice, sent, flush, say } = names(["add three floors"]);
    voice.setListenForNames(true);
    await flush();
    await say();
    expect(voice.getSnapshot()).toEqual({ phase: "names", speaking: false });
    vi.advanceTimersByTime(VOICE.sendDelayMs * 2);
    expect(sent).toEqual([]);
  });

  it("the button takes the microphone for a request, and listening for names resumes after it", async () => {
    const { voice, flush, say, opened, openNow } = names(["add three floors", "Mochi, hello"]);
    voice.setListenForNames(true);
    await flush();
    await voice.start();
    expect(opened[0]?.open).toBe(false); // the names microphone was released
    expect(voice.micState).toBe("on");
    await say(); // a request without a name is fine when asked for with the button
    expect(voice.getSnapshot()).toMatchObject({ phase: "review", text: "add three floors" });
    vi.advanceTimersByTime(VOICE.sendDelayMs);
    await flush();
    expect(voice.getSnapshot()).toMatchObject({ phase: "sent" }); // still shown
    expect(opened).toHaveLength(3);
    expect(openNow()).toBe(1);
    expect(voice.micState).toBe("names");
  });

  it("turning it off releases the microphone", async () => {
    const { voice, flush, openNow } = names([]);
    voice.setListenForNames(true);
    await flush();
    voice.setListenForNames(false);
    expect(openNow()).toBe(0);
    expect(voice.getSnapshot()).toEqual({ phase: "off" });
    expect(voice.micState).toBe("off");
  });
});
