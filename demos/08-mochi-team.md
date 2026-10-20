# Demo 08 - "Mochi, ask Architect"

Week 8 clip. Target length 50-60 s, 16:9, captions burned in, sound on (Mochi speaks). Every agent is your own Claude Code; speech in and out stays on the laptop.

## Setup (before recording)

1. Claude Code installed and signed in. `pnpm assets` has fetched the Kokoro voice (the Voice card says **Kokoro on this laptop (WebGPU)** after the first reply).
2. Headphones or speakers low, so Mochi's voice is heard on the recording but does not swamp the microphone. Front light on your hands; Windows Studio Effects off.
3. `pnpm dev`; open http://127.0.0.1:5173 in Edge (dark theme), sample project open. The panel header says **Mochi** and **Ready**; the team strip shows Architect, Climate, Product and Reviewer.
4. Off camera, say one warm-up request ("Mochi, what is in this scene? One sentence.") so every model is loaded and the team files exist. Undo anything it changed, then reload the page.
5. Start the camera and check the Detection card: both hands found close to 100%.
6. Recorder at 1080p, 30 fps, capturing the browser window and system audio.

## Shot list

| # | Time | Do | Voice-over / caption |
|---|---|---|---|
| 1 | 0-4 s | The building; the team strip shows four idle specialists. | "Mochi leads a design team. All of it is my own Claude." |
| 2 | 4-14 s | Press the microphone. Point at the tower while saying "Mochi, ask Architect for a stair core here and Climate for the winter shadows." Marker **1** on the tower. Nod. | "One request, two specialists." |
| 3 | 14-22 s | Mochi's reply shows two hand-off chips; the strip shows Architect and Climate **working**. Mochi says it has handed them out. | "Mochi hands the work out and stays free." |
| 4 | 22-30 s | The core appears in the model; the **Sun study** badge appears and long shadows stretch north. | "Architect models, Climate sets the winter sun." |
| 5 | 30-38 s | Say "Mochi, status?" and nod. Mochi answers aloud while both keep working. | "I can ask what everyone is doing at any time." |
| 6 | 38-48 s | Both chips turn **done**; Mochi speaks its report. | "And it tells me when they are done." |
| 7 | 48-55 s | Press Architect's hand-off chip: its tool calls. Back. Press Undo once: the core goes, labelled "Architect: ...". | "Every specialist's work is one undo step." |
| 8 | 55-60 s | Lower your hands. | "Next: reviewing each agent's changes before they land." |

## Check on the real microphone (fill in before posting)

- Shot 2 routed both tasks correctly in two of three takes: ___ / 3
- The transcript of shot 2, word for word: ______
- Shot 5: time from the nod to Mochi's first word: ______ s (target: about 3 s)
- First sound p90 from the Voice card: ______ ms (target: under 1200 ms)
- The undo label in shot 7: ______

## Expected result

- Mochi's turn ends at the hand-off; the specialists keep working while Mochi answers the status question.
- Architect and Climate run side by side (Climate only reads the model).
- Climate's study: 21 December at noon in London puts the sun about 15 degrees up in the south (see `docs/agents.md`).
- Mochi's report comes on its own when both tasks have finished, and is spoken.

## Check after recording

- The team strip, hand-off chips and the Sun study badge are readable on a phone.
- Mochi's voice is audible and in sync; nothing else is spoken.
- No other windows, notifications or account details in frame.
