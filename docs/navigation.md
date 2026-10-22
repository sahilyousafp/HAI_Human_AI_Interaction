# Navigation and selection

The built-in viewer shows the open project's scene (millimetres, Z up, like Rhino). Hands and mouse drive the same turntable camera, which orbits around a target point and never rolls.

## Hands

Engage first by holding an open palm toward the camera (see [gestures.md](gestures.md)).

| Do | Effect |
|---|---|
| Pinch and drag with one hand | Orbit, like dragging the model with the mouse. Drag down looks from higher. The view stays between 5 and 89 degrees above the ground |
| Pinch with both hands at once, move them apart or together | Zoom in or out |
| Pinch with both hands, move them together sideways or up and down | Pan; the view moves the opposite way |
| Close one hand into a fist (at rest) and move it | Pan: the model follows the hand like a grabbed map. The pointer shows a pan icon while the hand is a fist, filled while the view moves. Settings > Gestures > Fist drag can change it to orbit or nothing, for each hand |
| Pinch with both hands and turn them like a dial | Turn the view the same way (turns under 0.6 degrees per frame are ignored as tracking jitter) |
| Let go while still moving (a flick) | The view coasts on and slows to a stop, for orbit, zoom, pan and turn alike, whether by pinch or by fist. Pinching again, clicking or scrolling catches it |
| Close a hand into a fist mid-drag | Clutch: move your hand back without moving the view, then pinch again. Only a fist closed at rest pans |
| Hold a fist still for 1.5 s | The fist hold: back to Select (set in Settings > Gestures > Fist hold). A fist that moves never does this |
| Point (a relaxed hand, not pinching) | A ring follows your pinch point, anywhere on the page; the element under it is highlighted |
| Both hands in view | Each hand has its own pointer (left amber, right blue) and taps, presses and scrolls on its own. Hover in the model follows the hand that pinched last |
| One hand navigating, the other makes a fist and moves | Ignored: one hand moves the view at a time (a fist drag also waits while a ring is open or two hands pinch) |
| One hand busy, the other pinches | A hand holding a ring open or already dragging keeps its gesture; the other hand's pinch is its own tap or drag, not a two-hand zoom |
| Pinch and let go without moving (tap) | Select the highlighted element; a tap on empty space clears the selection |

Hand navigation runs entirely in the browser. It keeps working while the bridge is offline; only edits wait for the bridge.

## Mouse and keyboard

| Do | Effect |
|---|---|
| Left drag | Orbit |
| Right or middle drag | Pan |
| Wheel | Zoom |
| Left click | Select (click on empty space to clear) |
| Ctrl+Z | Undo the last change (a whole transaction) |
| Ctrl+Shift+Z or Ctrl+Y | Redo |

## Gains

| Setting | Value | Where |
|---|---|---|
| Orbit, horizontal | 270 degrees per full camera-frame width of hand movement | `apps/web/src/viewer/navigation.ts` |
| Orbit, vertical | 120 degrees per full frame height | same |
| Two-hand pan | 1.2 view heights per full frame of midpoint movement | same |
| Fist pan | Same gain as the two-hand pan (1.2 view heights per full frame of the palm's movement); starts after the fist has moved 3% of the frame width (`clutch.moveMin`) | same, `packages/perception/src/gestures/config.ts` |
| Two-hand zoom | Proportional to the change in distance between the hands | same |
| Two-hand turn | 1 degree of view per degree the hands turn | same |
| Flick | Measured over the last 100 ms before letting go; coasting slows with a 320 ms time constant, so the view travels about a third of a second's worth of the release speed | same |
| Pointer gain | 1.3 around the centre, so the hand does not have to reach the frame edges | `apps/web/src/viewer/Viewer.tsx` |
| Camera easing | 100 ms time constant: hand input arrives about every 40 ms, so the camera glides between samples instead of stepping | same |
| Mouse orbit | 0.3 degrees per pixel | same |

## Latency

The status bar shows **Gesture to render p90**: the time from the camera capturing a frame to the viewer drawing the camera change it caused, over the last 3 seconds. The target on a laptop with a GPU is under 50 ms.

## Projects

The toolbar shows the open project and its save state. Every change is saved to `scene.aex.json` in the project folder within 2 seconds. **Open project** takes a folder path; a folder without a scene file starts from the sample building. The last project opened is reopened on the next start.
