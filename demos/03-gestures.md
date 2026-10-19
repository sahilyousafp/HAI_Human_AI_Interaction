# Demo 03 - "Jitter before and after, and a pinch that never misfires"

Week 3 clip. Target length 45-60 s, 4:5 or 16:9, captions burned in. Can be posted together with Week 2.

## Setup (before recording)

1. Front light on your hands, plain background, sit 50-70 cm from the laptop, elbows resting on the desk.
2. `pnpm dev`; open http://127.0.0.1:5173 in Edge (dark theme). Start the camera.
3. Keep the Gestures card (under the preview) in frame.
4. Recorder at 1080p, 30 fps.

## Shot list

| # | Time | Do | Voice-over / caption |
|---|---|---|---|
| 1 | 0-8 s | Tick **Show raw points**. Hold one hand still: hollow raw dots shimmer, the smoothed skeleton stays still. Move fast: the skeleton keeps up. | "Raw tracking jitters. Smoothed tracking stays still, and still keeps up." |
| 2 | 8-14 s | Untick raw points. Pinch a few times without engaging: nothing happens. | "Gestures do nothing until I ask for attention." |
| 3 | 14-20 s | Hold an open palm toward the camera: **Engaged** lights up. | "Open palm: engaged." |
| 4 | 20-28 s | Quick pinch (OK sign): last gesture shows **tap (right)**. Pinch and move: **drag**. | "A short pinch is a tap. Hold and move, it's a drag." |
| 5 | 28-36 s | During a drag, close into a fist, move, open into a pinch again: **clutch**, then a fresh drag. | "A fist is the clutch: reposition without moving anything." |
| 6 | 36-44 s | Pinch with both hands, spread them: **Two hands**. | "Two hands: zoom and pan, coming next week." |
| 7 | 44-52 s | Nod: **nod**. Shake: **shake**. | "Nod for yes, shake for no." |
| 8 | 52-56 s | Lower both hands and wait: **Not engaged**. | "Hands down: it stops listening." |

## Numbers to record on the real laptop (fill in before posting)

- Recogniser time per frame (Gestures card): ______ ms (target: under 2 ms)
- Frame rate with hands + face: ______ fps
- Taps recognised on the first try: ___ / 10
- False commands while talking with your hands, not engaged: ___ in 30 s (target: 0)

## Expected result

- No gesture produces a command before **Engaged**.
- Taps, drags, clutch, two-hand, nod and shake each show in **Last gesture** within a second of doing them.
- A pinch with every finger folded counts as a fist (clutch), not a pinch. Keep the other fingers relaxed open for a pinch.

## Check after recording

- The Gestures card text is readable on a phone (zoom the browser to 125% if needed).
- Captions name each gesture as it happens.
