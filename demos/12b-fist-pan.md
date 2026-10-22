# Demo 12b - "Grab the view"

A short bonus clip (not a roadmap week). Target length 30-45 s, 16:9, captions burned in. A closed hand grabs the model and slides it across the screen and stops where your hand stops, the other hand orbits with a pinch, and a still fist held for 1.5 s snaps the tool back to Select. Show my hands is on, so the closed hand is visible.

## Setup (before recording)

1. `pnpm dev`; open http://127.0.0.1:5173 in Edge, light theme, the sample building or any project with a few blocks.
2. Front light on both hands; Windows Studio Effects off. Start the camera and check both hands are found close to 100% (Settings > Camera and tracking).
3. Settings > Gestures: Fist drag is "Pan the view" for both hands and Fist hold is "Cancel" (the defaults; Reset to defaults if unsure). Settings > Features: everything on. Show my hands: on.
4. Recorder at 1080p, 30 fps, capturing the browser window.

## Shot list

| # | Time | Do | Voice-over / caption |
|---|---|---|---|
| 1 | 0-6 s | Hold an open palm until engaged. Move the left hand into view, open: the pointer is a ring. | "Open hand: a pointer." |
| 2 | 6-16 s | Close the left hand into a fist at rest and drag it across the screen. The pointer turns into four arrows, and fills in while the view moves with your hand. | "Close your hand and the view moves with it." |
| 3 | 16-22 s | Sweep the fist sideways fast and open it while still moving: the view stops right where your hand was, with no drift. | "It stops where your hand stops." |
| 4 | 22-30 s | Right hand: pinch-drag to orbit. Then the left fist drag again: pan while the right hand rests. | "Right hand orbits. Left hand pans." |
| 5 | 30-40 s | Press M (Move). Hold the left fist still: nothing for a second, then at 1.5 s the status bar goes back to Select. Then fist-drag again with Move active: it pans and never cancels. | "Hold still to cancel. Move to pan." |

## Check on the real camera (fill in before posting)

- Fist-pan with each hand ten times: view moved as expected ___ / 10 (left), ___ / 10 (right)
- Accidental pans while moving open hands around the frame for 30 s: ___ (target: none)
- Accidental pans in 20 tries of clutching mid-drag (pinch-drag, close the fist, move back, open): ___ (target: none)
- A fist held still for 1.5 s cancelled the tool in ___ / 10 tries; a 1 s fist never did: yes / no
- Status bar "Gesture to render" p90 while fist-panning: ______ ms (target: under 50)
- Closing the second hand into a fist while panning stopped the pan and did not trigger the stop gesture: yes / no

## Check after recording

- The four-arrow pointer is readable on a phone, in both hands' colours (left amber, right blue).
- No private project names or paths in frame.
