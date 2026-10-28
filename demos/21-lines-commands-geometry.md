# Demo 21 - "Square lines, spoken commands, copy along a curve"

> Covered by automated tests with the fake camera and fake agent: `e2e/line-tool.spec.ts`, `e2e/view-cube.spec.ts`, `e2e/spoken-commands.spec.ts` and `e2e/geometry-tools.spec.ts`. The OpenCascade tools (loft, sweep, boolean, offset) are tested as Python recipes against known volumes, but have not been run inside the app on the machine this was written on (Windows Smart App Control blocks the library there), so shot 8 stays out until it has been run somewhere it loads. The checklist at the end is for the real camera and microphone, before posting.

Target length about 60 s, 16:9, captions burned in. Right hand draws, left hand talks. Show my hands is on. Claude Code is installed and signed in.

## Setup (before recording)

1. `pnpm dev`; open http://127.0.0.1:5173 in Edge, light theme. The sample project, fresh. Chat rail open.
2. Show my hands on. Front light on both hands. Start the camera, hold an open palm until engaged.
3. Settings > Drawing aids: Ortho on, angle step 45, Endpoint on. Settings > Claude chat: on.
4. Recorder at 1080p, 30 fps, browser window only.

## Shot list

| # | Time | Do | Voice-over / caption |
|---|---|---|---|
| 1 | 0-10 s | Right hand: pick **Line** (say "line"). Draw three segments with a deliberately unsteady hand. Every segment lands on a 45 degree step; the notice shows the length and angle. | "A hand is a bad ruler. Ortho is a lock." |
| 2 | 10-16 s | Press **Length** in the panel at the top right, say "length 3 metres". The next point lands exactly 3 m along. | "Say a length, get that length." |
| 3 | 16-24 s | Press **Top** on the view cube: a true plan. Press **Front**: draw an upright line; Ortho holds it vertical. Press **Perspective**. | "Real orthographic views, and lines that draw in them." |
| 4 | 24-32 s | Select Block B. Left hand speaks: "copy 2 times 6 m along y". Two copies appear; the bar says "Nothing was sent to the agent". Undo once: both go. | "No model was asked." |
| 5 | 32-38 s | Place marker A with the Marker tool. Select a block and say "rotate 90 about marker A". | "Turn it about a point I placed." |
| 6 | 38-44 s | Say "select all walls and move 2 m up", then "isolate", then "show all". | "Chain commands. Hide and isolate save nothing." |
| 7 | 44-50 s | Draw a curve with the Line tool. Hold and say "Architect, copy this post along the curve every 30 cm, the width starting at 15 centimetres and tapering to 5". The copies appear along the curve, narrowing. The chat folds the call into one steps line. Undo once. | "Not a script. A tool the agent has." |
| 8 | 50-58 s | **Only after it has been run on a machine where OpenCascade loads:** "Architect, loft a roof through these two sections", then accept the card that lists what is installed. | "The geometry kernel is installed once, after you agree." |
| 9 | 58-62 s | Settings > Claude chat off. The chat disappears. Say a sentence that is not a command: "Not a command". | "Or turn Claude off and keep the commands." |

## Check on a real run (fill in before posting)

- Does a real, unsteady hand land on the 45 degree steps in shot 1 (the tests use a scripted path):
- Does the speech model hear "6 m", "marker A" and "30 cm" the way the grammar reads them (it only accepts a single letter after "marker"):
- Does the real agent make the array in shot 7 with the width numbers as said (read the tool call in the chat):
- Shot 8, if used: install size and time on this machine, and whether the loft looks right in the viewer:
