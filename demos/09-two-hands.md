# Demo 09 - "Both hands"

Week 9 clip. Target length 45-55 s, 16:9, captions burned in, sound on (Mochi speaks). Shows that both hands are now full pointers, each with its own ring: the left hand points things out with the reference ring (sketches for the agent) while the right hand navigates and edits with the edit ring, and the stop gesture.

## Setup (before recording)

1. `pnpm dev`; open http://127.0.0.1:5173 in Edge (dark theme), the sample project open. Claude Code signed in for the last shots.
2. Front light on both hands; Windows Studio Effects off. Sit far enough back that both hands fit in the camera image with room to move.
3. Start the camera and check the Detection card: both hands found close to 100%.
4. Settings > Tool rings: Dominant hand **Right**. In Settings > Gestures, the long pinch reads **Open the action ring** for the right hand and hold to talk (the reference ring when silent) for the left.
5. Off camera, sketch and clear one path so the timing is in your hands.
6. Recorder at 1080p, 30 fps, capturing the browser window and system audio.

## Shot list

| # | Time | Do | Voice-over / caption |
|---|---|---|---|
| 1 | 0-4 s | Raise both hands: two pointers, amber left and blue right. | "Both hands are pointers now." |
| 2 | 4-12 s | Left hand: long pinch and keep still without a word; the reference ring fades in. Steer up to **Sketch line**, let go. | "The left hand has its own ring: pointing things out." |
| 3 | 12-22 s | Left hand pinches on the ground beside the building and drags: a dashed path in amber follows, labelled S1 when you let go. Sketch a second one, S2. | "Pinch, drag, let go: a path for the agent." |
| 4 | 22-28 s | While the left hand is mid-way through S3, the right hand orbits the view; let go with the left. | "One hand sketches while the other turns the view." |
| 5 | 28-34 s | Right hand: long pinch; the edit ring opens at once. Flick to **Move**, pinch Block C and drag it 2 m; let go. | "The right hand edits." |
| 6 | 34-40 s | Left hand: hold anywhere and say "Mochi, how long is S1?" Let go. Mochi answers from the sketch. | "Every request carries the sketches." |
| 7 | 40-46 s | Right hand presses the gear to open Settings, then pinches on the list and flicks it up: it coasts. | "And both hands scroll." |
| 8 | 46-52 s | Ask Mochi for something slow; while it works, clench both fists ("Open both hands to stop" appears), then open both hands: Mochi stops. | "Stop is two fists, then open hands. Showing my hands no longer stops anything." |
| 9 | 52-55 s | Lower your hands. | "Next: a studio you can film: settings in a sheet, and my hands drawn over the screen." |

## Check on the real camera (fill in before posting)

- Shot 3: paths sketched in one go in two of three takes: ___ / 3
- Shot 4: the left hand's drag survived the right hand's orbit in two of three takes: ___ / 3
- Shot 6: Mochi's answer matched S1's length: ___
- Shot 8: stop fired on the first try in two of three takes: ___ / 3
- Open palms held for 5 s with Mochi working: it kept working (yes / no)

## Expected result

- Sketches are not part of the model and are never an undo step of it; up to 8 are kept, and a request carries them all and clears them.
- The move is one undo step ("Move").
- Hover and the spoken "this" follow the hand that pinched last.
- The stop fires once, and neither fist cancels the active tool on the way.

## Check after recording

- Both pointer colours, the rings and the S labels are readable on a phone.
- No other windows, notifications or account details in frame.
