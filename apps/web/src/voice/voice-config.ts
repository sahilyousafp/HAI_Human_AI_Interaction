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
