# Demo 04 - "Orbiting a building with one hand"

Week 4 clip. Target length 40-60 s, 16:9 (the viewer is wide), captions burned in.

## Setup (before recording)

1. Front light on your hands, elbows resting on the desk.
2. `pnpm dev`; open http://127.0.0.1:5173 in Edge (dark theme). The sample building loads in the viewer.
3. Start the camera. Untick **Debug view** if the preview distracts, or keep it to show the tracking.
4. Recorder at 1080p, 30 fps, capturing the browser window.

## Shot list

| # | Time | Do | Voice-over / caption |
|---|---|---|---|
| 1 | 0-5 s | Show the building, hands in your lap. | "A building, and my hands. No mouse." |
| 2 | 5-8 s | Open palm: **Engaged**. | "Open palm: it's listening." |
| 3 | 8-20 s | Pinch and drag right and up: the building turns. | "Pinch and drag to orbit." |
| 4 | 20-26 s | Mid-drag, make a fist, move back, pinch again, continue turning. | "A fist is the clutch: reset your hand, keep going." |
| 5 | 26-36 s | Both hands pinch: spread (zoom in), bring together (zoom out), move sideways (pan). | "Two hands: zoom and pan." |
| 6 | 36-46 s | Relax your hand: the ring follows; hover the north wall; quick pinch: **North wall (wall)** selected. | "Point and tap to select." |
| 7 | 46-52 s | Show the status bar: **Gesture to render p90**. | "From camera to screen in N milliseconds." |
| 8 | 52-56 s | Lower your hands. | "Next week: tools in the palm of your hand." |

## Numbers to record on the real laptop (fill in before posting)

- Gesture to render p90: ______ ms (target: under 50 ms)
- Frame rate with hands + face: ______ fps
- Taps that selected the intended element: ___ / 10

## Expected result

- Every control in `docs/navigation.md` works: one-hand orbit, two-hand zoom and pan, clutch, hover, tap select, tap on empty space to clear, mouse orbit/pan/zoom, Ctrl+Z and Ctrl+Shift+Z.
- The view never flips upside down (elevation stays between 5 and 89 degrees).

## Check after recording

- The selected element's name in the status bar is readable on a phone.
- No other windows or notifications in frame.
