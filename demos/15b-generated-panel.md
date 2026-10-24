# Demo 15b - "My AI builds a panel for the job"

A short bonus clip (not a roadmap week). Target length 45-60 s, 16:9, captions burned in. You ask your AI for a 150 mm clearance between a wall and a column, with a tolerance. It offers to build a panel for it, a nod opens the panel, and dragging its slider by hand moves the column live. The readout turns red outside the tolerance, Done keeps the result as one undo step, and the panel closes. Show my hands is on, so the pinch is visible.

## Setup (before recording)

1. `pnpm dev`; open http://127.0.0.1:5173 in Edge, light theme, the sample building (the project's `col-a1` column and the north wall are the pair in the clip).
2. Claude Code is installed and signed in (the agent panel says Ready). Settings > Features: **Generated panels** on, **Nod and shake** on, everything else on. Show my hands: on.
3. Front light on both hands; Windows Studio Effects off. Start the camera and check both hands are found close to 100% (Settings > Camera and tracking). Hold an open palm until engaged.
4. Settings > Gestures: Nod is "Yes" and Shake is "No" (the defaults; Reset to defaults if unsure).
5. Do one practice run first. The agent writes the panel fresh every time, so the look differs; if the panel it writes has a select, a text field or tiny controls, say "use a slider and big buttons" and run it again. Record only a take whose panel has a slider you can drag by hand.
6. Recorder at 1080p, 30 fps, capturing the browser window.

## Shot list

| # | Time | Do | Voice-over / caption |
|---|---|---|---|
| 1 | 0-10 s | Point at the north wall, then at the column `col-a1`, and say: "Architect, keep 150 millimetres between this wall and this column, with some tolerance." | "I just ask." |
| 2 | 10-18 s | The agent panel shows a card: "Open a panel? Set the wall to column clearance", with Open and Skip. Nod. | "It offers a panel for the job. A nod says yes." |
| 3 | 18-26 s | A frame appears at once with "Your agent is writing the panel", then the panel: a clearance slider, a readout and an Apply button. | "It writes the panel for this task, right now." |
| 4 | 26-42 s | Pinch the slider and drag it by hand. The column slides along the wall as you drag. Drag past the tolerance: the readout turns red. Drag back inside. | "The model moves as I move it. Red means out of tolerance." |
| 5 | 42-50 s | Press Done by hand. The panel closes; the agent says one line about what was kept. | "Done keeps it as one step." |
| 6 | 50-58 s | Open the Undo strip or press Ctrl+Z: the column goes back in one step, and "Undid: Clearance" shows. | "One undo, and it is gone." |

## Check on the real camera (fill in before posting)

- The offer card was answered by a nod ___ / 10 times; shaking skipped it ___ / 10 times
- Accidental nods while speaking the request (none should open the panel before the card shows): ___ (target: none)
- A hand pinch-drag moved the slider smoothly in ___ / 10 tries; pinching the panel's Done opened and closed ___ / 10 tries
- The panel's frame appeared within a blink of the nod (the frame, not the content): yes / no
- Status bar "Gesture to render" p90 while dragging the slider: ______ ms (target: under 50)
- Moving the hand off the panel and orbiting the model with the other hand worked while the panel was open: yes / no
- What the panel the agent wrote looked like (controls it drew, anything unusable by hand): ______

## Check after recording

- The slider and the red tolerance readout are readable on a phone.
- The nod is visible or the caption says "nod" (the camera view is not in frame).
- No private project names or paths in frame; the agent's reply does not show a personal path.
- The take shows the whole story in one go: offer, nod, panel, drag, Done, undo.
