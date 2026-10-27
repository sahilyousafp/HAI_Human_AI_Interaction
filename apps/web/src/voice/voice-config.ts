/** Every voice timing in one place. docs/voice.md is checked against these values by a unit test. */
export const VOICE = {
  /** Silence after speech that ends an utterance. */
  silenceMs: 800,
  /** An utterance ends after this long, whatever. */
  maxUtteranceMs: 20_000,
  /** Listening stops if no speech starts within this long. */
  noSpeechMs: 8000,
  /** The transcript is sent this long after the utterance ends, unless the user sends or discards it first. */
  sendDelayMs: 5000,
  /** After a bare name ("Hey Mochi") the microphone stays open this long for the rest of the request. */
  afterNameMs: 5000,
  /** The hand pointer must rest on an element this long while speaking for the element to be captured. */
  dwellMs: 300,
} as const;

/** The fewest tokens a transcript may have, however short the utterance. */
const MIN_TOKENS = 16;

/**
 * How many tokens Moonshine may write for an utterance of `samples` at `rate` Hz. Its guard against repeated output is
 * 6 tokens per second of audio, which transformers.js rounds down to whole seconds: a one-word command ("Undo.", under
 * a second) got no tokens at all and came out as "Und" or nothing. The same 6 per second, rounded up, but never fewer
 * than 16.
 */
export const tokenLimit = (samples: number, rate = 16_000): number =>
  Math.max(MIN_TOKENS, Math.ceil((samples / rate) * 6));
