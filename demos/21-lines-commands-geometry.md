# Demo 21 - "Square sketches, a view cube, spoken commands"

> Covered by automated tests with the fake camera and fake agent: `e2e/view-cube.spec.ts`, `e2e/drawing-aids.spec.ts` and `e2e/spoken-commands.spec.ts`, and the correction of mishearings by `apps/web/src/voice/lexicon.test.ts`. The Line tool, the spoken copy, array and scale, and the geometry kernel (copy along a curve, loft, sweep, boolean, offset) that this clip first showed are gone: the hosts model now (`docs/decisions.md`, "The creation tools and the geometry kernel go"). Ask the agent for those and it has Rhino do them. The checklist at the end is for the real camera and microphone, before posting.

Target length about 55 s, 16:9, captions burned in. Right hand edits, left hand talks. Show my hands is on. Claude Code is installed and signed in.

## Setup (before recording)

1. `pnpm dev`; open http://127.0.0.1:5173 in Edge, light theme. The sample project, fresh. Chat rail open.
2. Show my hands on. Front light on both hands. Start the camera, hold an open palm until engaged.
3. Settings > Drawing aids: Ortho on, angle step 45, Endpoint on. Settings > Features > Claude chat: on.
4. Recorder at 1080p, 30 fps, browser window only.

## Shot list

| # | Time | Do | Voice-over / caption |
|---|---|---|---|
| 1 | 0-10 s | Left hand: reference ring, **Sketch line** (or say "path"). Sketch a path with a deliberately unsteady hand. It lands on a 45 degree step; the notice shows the length and angle. | "A hand is a bad ruler. Ortho is a lock." |
| 2 | 10-16 s | Right hand: edit ring, **Rotate**. Drag on Block C: the turn steps by 45 degrees, with its angle at the pivot. Let go. | "Turns lock to the step too." |
| 3 | 16-24 s | Press **Top** on the view cube: a true plan. Press **Front**: a true elevation, verticals parallel. Press **Perspective**. | "Real orthographic views, from the cube." |
| 4 | 24-32 s | Select Block B. Left hand speaks: "move 6 m along y and rotate 90". It moves and turns; the bar says what was done and that nothing was sent to the agent. Undo once: both steps go. | "No model was asked." |
| 5 | 32-38 s | Place marker A with the Marker tool. Select a block and say "rotate 90 about marker A". | "Turn it about a point I placed." |
| 6 | 38-44 s | Say "select all walls and move 2 m up", then "isolate", then "show all". | "Chain commands. Hide and isolate save nothing." |
| 7 | 44-50 s | Select Block B and say "copy 4 times 6 m along y". Nothing changes; the bar says to ask the agent. | "Copies make geometry. That is the agent's job, in Rhino." |
| 8 | 50-55 s | Settings > Features > Claude chat off. The chat disappears. Say a sentence that is not a command: "Not a command". | "Or turn Claude off and keep the commands." |

## Check on a real run (fill in before posting)

- Does a real, unsteady hand land on the 45 degree steps in shot 1 (the tests use a scripted path):
- Does the Rotate drag in shot 2 step cleanly by 45 degrees with a real hand:
- Does the speech model hear "6 m", "marker A" and "4 times" the way the grammar reads them (it only accepts a single letter after "marker"):
- Did any take show a mishearing put right by sound (the bar shows what was heard and what was done)? Note the words:
- Shot 7: the exact text the bar shows:
