# Demo 08 - "Mochi, ask Architect"

Week 8 clip. Target length 50-60 s, 16:9, captions burned in, sound on (Mochi speaks). Every agent is your own Claude Code; speech in and out stays on the laptop. Architect models in Rhino, with a script you approve; Climate only reads the model and sets HAI's sun.

## Setup (before recording)

1. Claude Code installed and signed in. `pnpm assets` has fetched the Kokoro voice (Settings > Voice names Kokoro on this laptop after the first reply).
2. Rhino 8 or 9 with the HAI plugin. Open a model with a tower in it that you can show publicly, run `HaiConnect`, then minimise Rhino. The top bar shows the Rhino pill connected.
3. Headphones or speakers low, so Mochi's voice is heard on the recording but does not swamp the microphone. Front light on your hands; Windows Studio Effects off.
4. `pnpm dev`; open http://127.0.0.1:5173 in Edge (dark theme). The panel header says **Mochi** and **Ready**; the team strip shows the specialists.
5. Off camera, say one warm-up request ("Mochi, what is in this scene? One sentence.") so every model is loaded and the team files exist. Undo anything it changed (in Rhino), then reload the page.
6. Start the camera and check the Detection card: both hands found close to 100%.
7. Recorder at 1080p, 30 fps, capturing the browser window and system audio (and, for shot 7 only, Rhino's window).

## Shot list

| # | Time | Do | Voice-over / caption |
|---|---|---|---|
| 1 | 0-4 s | The Rhino model in HAI's viewer; the team strip shows the specialists idle. | "Mochi leads a design team. All of it is my own Claude." |
| 2 | 4-14 s | Pinch-tap the tower to select it. Press the microphone and say "Mochi, ask Architect for a stair core in this tower and Climate for the winter shadows." Nod. | "One request, two specialists." |
| 3 | 14-22 s | Mochi's reply shows two hand-off chips; the strip shows Architect and Climate **working**. Mochi says it has handed them out. | "Mochi hands the work out and stays free." |
| 4 | 22-30 s | Architect's approval card for the Rhino script: nod. The core appears in the viewer as Rhino builds it; the **Sun study** badge appears and long shadows stretch north. | "Architect has Rhino build it; Climate sets the winter sun." |
| 5 | 30-38 s | Say "Mochi, status?" and nod. Mochi answers aloud while both keep working. | "I can ask what everyone is doing at any time." |
| 6 | 38-48 s | Both chips turn **done**; Mochi speaks its report. | "And it tells me when they are done." |
| 7 | 48-55 s | Press Architect's hand-off chip: its tool calls, with the `host_run` script. Back. Bring Rhino's window up, press Ctrl+Z once: the core goes, in Rhino and in the viewer. Minimise Rhino. | "Every script is one undo step in Rhino." |
| 8 | 55-60 s | Lower your hands. | "Next: both hands, and a job for the left one." |

## Check on the real microphone and in a real Rhino (fill in before posting)

- Shot 2 routed both tasks correctly in two of three takes: ___ / 3
- The transcript of shot 2, word for word: ______
- Shot 5: time from the nod to Mochi's first word: ______ s (target: about 3 s)
- First sound p90 from Settings > Voice: ______ ms (target: under 1200 ms)
- How many scripts Architect ran for the core (one Ctrl+Z per script): ______
- The undo step's name in Rhino's undo list: ______
- The winter shadows were cast by and onto the Rhino model in the viewer: ___

## Expected result

- Mochi's turn ends at the hand-off; the specialists keep working while Mochi answers the status question.
- Architect and Climate run side by side (Climate only reads the model).
- Climate's study: 21 December at noon in London puts the sun about 15 degrees up in the south (see `docs/agents.md`).
- Mochi's report comes on its own when both tasks have finished, and is spoken.

## Check after recording

- The team strip, hand-off chips, the approval card and the Sun study badge are readable on a phone.
- Mochi's voice is audible and in sync; nothing else is spoken.
- No other windows, notifications or account details in frame.
