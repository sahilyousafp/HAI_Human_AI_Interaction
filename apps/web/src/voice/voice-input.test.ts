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
