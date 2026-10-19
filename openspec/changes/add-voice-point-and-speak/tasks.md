# Tasks

## 1. Assets and fixtures

- [ ] 1.1 Extend the asset script to fetch the Moonshine base ONNX files and the Silero VAD model with SHA-256 checks; verify a second run is a no-op and a tampered file fails
- [ ] 1.2 Record speech samples ("make this wall three hundred thick", "add three floors", silence) as WAV fixtures for Chromium's fake microphone (`--use-file-for-fake-audio-capture`); verify each plays as the fake microphone

## 2. Microphone and transcription

- [ ] 2.1 Implement microphone start and stop from the palette slot and the talk key, with the microphone-on indicator; verify "no microphone on load" and "listening from the palette" E2E
- [ ] 2.2 Add Silero VAD in an AudioWorklet with the 800 ms and 20 s limits; verify "silence ends the utterance" with the fake microphone
- [ ] 2.3 Add the Moonshine transcription worker (WebGPU, WASM fallback), releasing audio after use; verify "transcript of a known sample"
- [ ] 2.4 Add the "no audio on the network" E2E test; verify it passes and fails if a test-only audio upload is injected
- [ ] 2.5 Add microphone error states with recovery text; verify "microphone denied" E2E

## 3. Transcript and send window

- [ ] 3.1 Show the transcript with the 1.5 s countdown, editable on click; nod or Enter sends, shake or Escape discards; verify "nod sends immediately" and "shake discards" with injected gesture events
- [ ] 3.2 Add the opt-in cloud speech setting with its third-party label; verify "default is on-device"

## 4. Point-and-speak

- [ ] 4.1 Implement the utterance context recorder with the 300 ms dwell filter and ordered taps; verify "point at two columns" and "brief pass-over is ignored" with synthetic pointer events
- [ ] 4.2 Render numbered reference markers until send or discard; verify "markers shown" with a screenshot baseline
- [ ] 4.3 Send references with the request and add the bridge context block; verify "make this 300 thick" and "select first, then speak" with the fake agent CLI asserting the received turn

## 5. Docs

- [ ] 5.1 Document voice, privacy and point-and-speak in `docs/voice.md`; verify the documented timings match the config by a unit test

## 6. Demo

- [ ] 6.1 Write `demos/07-point-and-speak.md` (point at a wall, say "make it 300 thick", markers, nod to send, agent edits that wall, record end-of-speech-to-transcript p90) and record the clip; verify it works on the real microphone in two of three takes
