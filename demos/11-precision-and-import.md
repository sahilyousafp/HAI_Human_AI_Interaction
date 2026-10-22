# Demo 11 - "Drop in my Rhino model, then draw a wall that snaps to its corner"

Week 11 clip. Target length 45-60 s, 16:9, captions burned in. Shows three things on one model: a pointer that locks onto buttons, a real Rhino file dropped into the viewer, and a wall drawn by hand that snaps and runs square. Show my hands is on, as in demo 10.

## Setup (before recording)

1. `pnpm dev`; open http://127.0.0.1:5173 in Edge, light theme, a fresh project (open an empty folder with Open project).
2. Front light on both hands; Windows Studio Effects off. Start the camera and check both hands are found close to 100% (Settings > Camera and tracking).
3. Settings > Features: everything on, including Snap to buttons. Show my hands: on. Settings > Drawing aids: only Grid on.
4. A real Rhino file ready in Explorer, next to the browser (a building massing of a few hundred objects works well), saved without Save small.
5. Recorder at 1080p, 30 fps, capturing the browser window.

## Shot list

| # | Time | Do | Voice-over / caption |
|---|---|---|---|
| 1 | 0-8 s | Drag the .3dm from Explorer onto the model. The drop message shows, then the model appears and the view frames it. Read out the report. | "Drop in a Rhino model." |
| 2 | 8-14 s | Left hand: orbit the model. | "It is reference geometry: I can select, measure, section and move it." |
| 3 | 14-24 s | Point the right hand near, not on, the settings gear: the pointer locks onto it. Tap: the sheet opens. | "Pointers snap to the nearest button now, so a near miss still presses." |
| 4 | 24-34 s | Open Drawing aids, turn on Endpoint and Ortho, close the sheet. | "Snap and ortho are switches in the settings." |
| 5 | 34-52 s | Left hand: create ring, Wall. Start a wall near a corner of the model: the Endpoint ring and name show. Drag along the facade: the line holds square, the notice shows length and angle. Let go. | "It starts exactly on the corner and runs square." |
| 6 | 52-58 s | Undo once with the toolbar. Lower the hands. | "Next: snapping at every height, and saving as a Rhino file." |

## Check on the real camera (fill in before posting)

- Shot 3: the pointer locked onto the gear on the first try in two of three takes: ___ / 3
- Shot 3: a pinch that drifted a little after locking still pressed the gear: ___ / 3
- Shot 5: the wall started on the corner (the ring and "Endpoint" showed) in two of three takes: ___ / 3
- Shot 1: the file you dropped imported with no skipped objects you cared about: yes / no. The report said: ______
- Frame rate with the model in view (Settings > Camera and tracking): ______ fps

## Expected result

The model arrives in about a second for a few hundred objects, the pointer visibly jumps onto the gear when it gets close, and the wall's first point has the corner's exact coordinates (select the wall and read its start in the agent's scene read).

## Check after recording

- No private model, file names or paths in frame (use a model you can show).
- The ring and its name are readable on a phone.
