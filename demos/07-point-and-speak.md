# Demo 07 - "Point at it and say it"

Week 7 clip. Target length 40-55 s, 16:9, captions burned in. Speech is transcribed on the laptop; the agent is your own Claude Code.

## Setup (before recording)

1. Claude Code installed and signed in. A headset or a quiet room; the laptop microphone works.
2. Front light on your hands. Windows Studio Effects off.
3. `pnpm dev`; open http://127.0.0.1:5173 in Edge (dark theme). The agent panel says **Ready**; the Voice card in the sidebar says **On this laptop**.
4. Say one warm-up request off camera ("What is in this scene? One sentence.") so the speech model is loaded and the session has started. Reload the page.
5. Start the camera and check the Detection card: both hands found close to 100%.
6. Recorder at 1080p, 30 fps, capturing the browser window.

## Shot list

| # | Time | Do | Voice-over / caption |
|---|---|---|---|
| 1 | 0-4 s | The building, hands in your lap. Header shows **Mic off**. | "The microphone is off until I ask." |
| 2 | 4-8 s | Open palm: **Engaged**. Long pinch, flick to **Ask agent**: **Mic on**, "Speak now". | "Ask agent, and it listens." |
| 3 | 8-16 s | Point at the south wall and hold while saying "make it 300 thick". Marker **1** appears on the wall; the level meter moves. | "Point at it and say it." |
| 4 | 16-20 s | Stop talking: **Mic off**, the transcript appears with "1 South wall" under it and the countdown. | "Transcribed on this laptop. Nothing is uploaded." |
| 5 | 20-23 s | Nod. The request goes to the agent at once. | "A nod sends it." |
| 6 | 23-38 s | The agent's chips (`get_elements`, `update_elements`); the wall gets thicker. | "It changes exactly that wall." |
| 7 | 38-45 s | Say "add three floors" without pointing, then shake your head: **Discarded**. | "Changed my mind: a shake throws it away." |
| 8 | 45-50 s | Lower your hands. | "Next: reviewing the agent's changes before they land." |

## Check on the real microphone (fill in before posting)

- Shots 3-5 worked in two of three takes: ___ / 3
- The transcript of shot 3, word for word: ______
- The `update_elements` chip shows `wall-s` and a thickness of 300: ___
- End of speech to text p90 from the Voice card: ______ ms (target: under 1000 ms)

## Expected result

- The microphone indicator is on only while listening.
- The marker appears about 300 ms after the pointer rests on the wall, and clears when the request is sent.
- The agent receives the wall as reference 1 (see `docs/voice.md`).

## Check after recording

- The transcript, the reference chip and the marker are readable on a phone.
- No other windows, notifications or account details in frame.
