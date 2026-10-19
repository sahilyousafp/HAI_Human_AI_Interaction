# Navigation and selection

The built-in viewer shows the open project's scene (millimetres, Z up, like Rhino). Hands and mouse drive the same turntable camera, which orbits around a target point and never rolls.

## Hands

Engage first by holding an open palm toward the camera (see [gestures.md](gestures.md)).

| Do | Effect |
|---|---|
| Pinch and drag with one hand | Orbit. Drag right turns the model; drag up looks from higher. The view stays between 5 and 89 degrees above the ground |
| Pinch with both hands, move them apart or together | Zoom in or out |
| Pinch with both hands, move them together sideways or up and down | Pan |
| Close a hand into a fist mid-drag | Clutch: move your hand back without moving the view, then pinch again |
| Point (a relaxed hand, not pinching) | A ring follows your pinch point; the element under it is highlighted |
| Quick pinch (tap) | Select the highlighted element; a tap on empty space clears the selection |

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
| Two-hand zoom | Proportional to the change in distance between the hands | same |
| Pointer gain | 1.3 around the centre, so the hand does not have to reach the frame edges | `apps/web/src/viewer/Viewer.tsx` |
| Camera easing | 40 ms time constant | same |
| Mouse orbit | 0.3 degrees per pixel | same |

## Latency

The status bar shows **Gesture to render p90**: the time from the camera capturing a frame to the viewer drawing the camera change it caused, over the last 3 seconds. The target on a laptop with a GPU is under 50 ms.

## Projects

The toolbar shows the open project and its save state. Every change is saved to `scene.aex.json` in the project folder within 2 seconds. **Open project** takes a folder path; a folder without a scene file starts from the sample building. The last project opened is reopened on the next start.
