# Speech fixtures

Recorded phrases played as Chromium's fake microphone (`--use-file-for-fake-audio-capture`) by the voice tests in
`e2e/voice/`. Each is 16 kHz, 16-bit mono PCM: one second of silence, the phrase, then three seconds of silence, so
voice activity detection sees a clear start and end. The short phrases (`measure`, `undo`, `sketch-area`, `bake`, `copy-this-there`) have
four seconds before and five after instead: the speech detector can take three seconds to load on a busy laptop, and a
name about a second long would otherwise be over before it listens.

| File | Says |
|---|---|
| `make-this-wall-300-thick.wav` | "Make this wall three hundred thick." |
| `add-three-floors.wav` | "Add three floors." |
| `silence.wav` | Nothing (four seconds of silence) |
| `mochi-status.wav` | "Mochi, what is everyone doing?" |
| `hey-mochi-status.wav` | "Hey Mochi, what is everyone doing?" |
| `architect-stair-core.wav` | "Architect, add a stair core here." |
| `mochi-ask-climate.wav` | "Mochi, ask Climate to run a winter shadow study." |
| `product-bench.wav` | "Product, design a bench for the courtyard." |
| `reviewer-heights.wav` | "Reviewer, check the floor heights." |
| `measure.wav` | "Measure." |
| `undo.wav` | "Undo." |
| `sketch-area.wav` | "Sketch area." |
| `bake.wav` | "Bake to Rhino." |
| `measure-the-towers.wav` | "Measure the distance between these towers." |
| `copy-this-there.wav` | "Copy this.", a second and a half of silence, then "There." |

They were synthesised offline with the Windows speech voice by `scripts/make-speech-fixtures.ps1`. They are test
data only and are not shipped. Recordings of a real voice can replace them as long as they keep the same shape.
