# Speech fixtures

Recorded phrases played as Chromium's fake microphone (`--use-file-for-fake-audio-capture`) by the voice tests in
`e2e/voice/`. Each is 16 kHz, 16-bit mono PCM: one second of silence, the phrase, then three seconds of silence, so
voice activity detection sees a clear start and end.

| File | Says |
|---|---|
| `make-this-wall-300-thick.wav` | "Make this wall three hundred thick." |
| `add-three-floors.wav` | "Add three floors." |
| `silence.wav` | Nothing (four seconds of silence) |

They were synthesised offline with the Windows speech voice by `scripts/make-speech-fixtures.ps1`. They are test
data only and are not shipped. Recordings of a real voice can replace them as long as they keep the same shape.
