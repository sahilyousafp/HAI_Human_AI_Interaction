# Demo 20 - "Point, hold, speak"

> Each step below is covered by an automated test with the fake camera and recorded speech (`e2e/hold-to-talk.spec.ts`, `e2e/voice/*.spec.ts`), and "a wall along S1" was built by the real Claude Code (`HAI_LIVE_CLAUDE=1 pnpm exec playwright test e2e/hold-to-talk-live.spec.ts`). The checklist below is for the real camera and microphone, before posting.

Target length about 45 s, 16:9, captions burned in. A long pinch says "this" and listens: hold on a wall and speak, let go and it is done. Held silent, the hand's ring appears instead. The other hand sketches for the agent, and a tool's name alone picks the tool. Show my hands is on.

## Setup (before recording)

1. `pnpm dev`; open http://127.0.0.1:5173 in Edge, light theme. Claude Code is installed and signed in (the agent panel says Ready). The sample project, fresh.
2. Show my hands on. Front light on both hands; Studio Effects off. Start the camera, hold an open palm until engaged (the speech model loads now, so the first hold listens at once). Allow the microphone once beforehand.
3. Settings > Tool rings: Dominant hand **Right**. Settings > Drawing aids: Endpoint on.
4. Recorder at 1080p, 30 fps, capturing the browser window only.

## Shot list

| # | Time | Do | Voice-over / caption |
|---|---|---|---|
| 1 | 0-10 s | Right hand: pinch on a wall and keep still. The ring around the pointer fills, the wall is outlined, the chip says "Listening". Say "make this 300 thick" and let go. The chip says "Sent - shake to stop"; the wall thickens. | "Hold on what you mean, say it, let go." |
| 2 | 10-18 s | Left hand: pinch on open ground and keep still, without a word. The reference ring fades in. Flick up-right to **Area** and let go. | "Say nothing, and the ring is there." |
| 3 | 18-28 s | Left hand: draw around an empty courtyard. The dashed outline S1 stays, in the left hand's colour. | "My left hand points things out." |
| 4 | 28-38 s | Right hand: hold anywhere and say "Architect, a canopy over this". Let go. Architect builds a canopy over S1, and the sketch goes. | "The agent gets the sketch with the request." |
| 5 | 38-42 s | Say just "measure". Measure is picked at once; nothing goes to the agent. | "A tool's name alone picks the tool." |
| 6 | 42-46 s | Settings > Tool rings > Dominant hand **Left**: hold silent with the left hand, and the action ring is on the left now. | "Left-handed? The rings swap." |

## Check on a real run (fill in before posting)

- Time from the ring filling to the chip saying "Listening" on the first hold of the session, and on a later one (measured in the tests: about 0.4 s and 50 ms):
- Was the first word ever cut off (start speaking as soon as the chip says "Listening"):
- Did a silent hold ever start listening by mistake (a cough, the room):
- Did a quick flick before speaking ever pick a tool when you meant to speak (count it in Settings > Camera > Detection: flicks against holds with speech):
- Was "make this 300 thick" sent with the wall as "this" (the agent's reply names the wall):
- Did Architect's canopy cover S1:
- Did "measure" pick Measure without a turn in the agent panel:
- Shake within 1.5 s of a sent request: did it stop that request, and leave other work running:

## Check after recording

- No private project names or paths in frame.
- The chip and the ring never overlap: the chip sits under the ring when it shows.
- The sketch label and the P markers are readable at 1080p.
