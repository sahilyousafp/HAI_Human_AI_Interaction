# Demo 07 - "Point at it and say it"

Week 7 clip. Target length 40-55 s, 16:9, captions burned in. Speech is transcribed on the laptop; the agent is your own Claude Code, and it changes the model in Rhino.

## Setup (before recording)

1. Claude Code installed and signed in. A headset or a quiet room; the laptop microphone works.
2. Rhino 8 or 9 with the HAI plugin. Open a model with a separate wall object on its south side (a box on a layer such as Walls, named "South wall", that you can show publicly), run `HaiConnect`, then minimise Rhino.
3. Front light on your hands. Windows Studio Effects off.
4. `pnpm dev`; open http://127.0.0.1:5173 in Edge (dark theme). The Rhino model is drawn in the viewer, the agent panel says **Ready**, and Settings > Voice says the speech runs on this laptop.
5. Say one warm-up request off camera ("What is in this scene? One sentence.") so the speech model is loaded and the session has started. Reload the page.
6. Start the camera and check the Detection card: both hands found close to 100%.
7. Recorder at 1080p, 30 fps, capturing the browser window.

## Shot list

| # | Time | Do | Voice-over / caption |
|---|---|---|---|
| 1 | 0-4 s | The model, hands in your lap. The top bar's microphone pill shows it off. | "The microphone is off until I ask." |
| 2 | 4-9 s | Open palm: **Engaged**. Right hand: pinch-tap the south wall. It is selected here and in Rhino, and the selection card says what Rhino calls it. | "Point at it." |
| 3 | 9-16 s | Left hand: a silent long pinch, the reference ring fades in; flick down to **Ask agent**. The microphone opens. Say "make it 300 thick". The level meter moves. | "And say it." |
| 4 | 16-20 s | Stop talking: the microphone closes, the transcript appears with its countdown. | "Transcribed on this laptop. Nothing is uploaded." |
| 5 | 20-23 s | Nod. The request goes to the agent at once. | "A nod sends it." |
| 6 | 23-38 s | Mochi hands it to Architect; the approval card shows the script for Rhino, naming the wall's id. Nod to allow. The wall gets thicker in the viewer as Rhino changes it. | "It changes exactly that wall, in Rhino." |
| 7 | 38-45 s | Press Ask agent again, say "add three floors" without pointing, then shake your head: **Discarded**. | "Changed my mind: a shake throws it away." |
| 8 | 45-50 s | Lower your hands. | "Next: a design team of agents, led by Mochi." |

## Check on the real microphone and in a real Rhino (fill in before posting)

- Shots 3-5 worked in two of three takes: ___ / 3
- The transcript of shot 3, word for word: ______
- The request carried the wall as Rhino describes it (open Architect's hand-off chip and read the request): ___
- The `host_run` script changes only the south wall's id and makes it 300 thick: ___
- End of speech to text p90 from Settings > Voice: ______ ms (target: under 1000 ms)

## Expected result

- The microphone indicator is on only while listening.
- The request carries the selected wall as Rhino describes it (see `docs/hosts.md`, What you see) and, because the selection card is open, is limited to it.
- The change is one undo step in Rhino.

## Check after recording

- The transcript, the selection card and the script are readable on a phone.
- No other windows, notifications or account details in frame.
