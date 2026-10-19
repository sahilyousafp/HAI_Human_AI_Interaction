# Demo 05 - "Tools in the palm of your hand"

Week 5 clip. Target length 45-60 s, 16:9, captions burned in. No agent is running in this demo: everything is direct.

## Setup (before recording)

1. Front light on your hands, elbows resting on the desk. Windows Studio Effects off (Quick settings > Studio effects).
2. `pnpm dev`; open http://127.0.0.1:5173 in Edge (dark theme). The sample building loads in the viewer.
3. Start the camera and check the Detection card: both hands found close to 100%.
4. Put the palette back to the default layout in the Tool palette card if you changed it (Measure right, Section bottom right, Move bottom, Undo top left).
5. Recorder at 1080p, 30 fps, capturing the browser window.

## Shot list

| # | Time | Do | Voice-over / caption |
|---|---|---|---|
| 1 | 0-4 s | The building, hands in your lap. | "No agent running. Just my hands." |
| 2 | 4-7 s | Open palm: **Engaged**. | "Open palm to start." |
| 3 | 7-12 s | Long pinch: the palette opens around your hand. Flick right, release: **Measure**. | "Hold a pinch: the tools come to your hand." |
| 4 | 12-20 s | Tap both ends of the tower facade: the label reads its width in mm. | "Measure a facade, in millimetres." |
| 5 | 20-30 s | Long pinch, flick down-right: **Section**. Pinch and drag down: the tower is cut; the height counts down. | "Slice the building with a hand." |
| 6 | 30-38 s | Long pinch, flick down: **Move**. Pinch the pavilion block and drag it along; it snaps. | "Move a block. It snaps to 100 mm." |
| 7 | 38-44 s | Long pinch, flick up-left: **Undo**. The block jumps back; Move is still active. | "And undo." |
| 8 | 44-50 s | Make a fist and hold: the status bar returns to **Select**. Clear the section. | "A fist takes you back to Select." |
| 9 | 50-55 s | Lower your hands. | "Next: the agent joins in." |

## Check on the real camera (fill in before posting)

- Each tool above was chosen by one flick, first attempt: Measure ___ Section ___ Move ___ Undo ___
- Facade measurement shown: ______ mm (Block B tower is 12000 mm wide)
- Gesture to render p90 while steering the palette: ______ ms (target: under 50 ms)

## Expected result

- The palette opens within a frame of the long pinch and follows the flick direction without aiming.
- Measure, Section and Move behave as described in `docs/tools.md`; Undo reverses the move and leaves Move active.
- Nothing in the clip needs the agent.

## Check after recording

- The palette labels and the measured value are readable on a phone.
- No other windows or notifications in frame.
