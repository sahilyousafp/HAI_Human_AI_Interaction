# Demo 24 - "Edit anywhere, from HAI"

> The HAI side of each step is covered by tests with a stand-in for the connector (`e2e/edit-surface.spec.ts`, `apps/bridge/src/hosts/host-link.test.ts`, `apps/web/src/tools/tools.test.ts`, `apps/web/src/tools/history.test.ts`). What Rhino itself does with an edit is checked by the list at the end, in Rhino 8, before posting.

Target length about 40 s, 16:9, captions burned in. Rhino stays minimised the whole time: everything is done in HAI.

## Setup (before recording)

1. Install the plugin 0.3.0 (`docs/hosts.md`, Rhino, Connecting). Open `tower.3dm` with the canopy from demo 23 in it, run `HaiConnect`, then minimise Rhino. The top bar shows the Rhino pill connected.
2. `pnpm dev`; open http://127.0.0.1:5173 in Edge, light theme, Claude Code signed in.
3. Show my hands on; camera started and engaged.
4. Recorder at 1080p, 30 fps, capturing the browser window only.

## Shot list

| # | Time | Do | Voice-over / caption |
|---|---|---|---|
| 1 | 0-5 s | A silent long pinch of the right hand: the edit ring (Select, Move, Rotate, Delete, Undo, Redo, Measure, Section). | "No walls, no slabs in HAI any more. Rhino models; HAI edits." |
| 2 | 5-13 s | Flick to Move. Pinch the canopy and drag it 2 m east, then let go. It stays put; a moment later Rhino's own result is drawn. | "I move a Rhino object by hand. Rhino makes the move, one undo step there." |
| 3 | 13-19 s | Flick to Rotate and turn it 15 degrees. Say "move this one metre north." | "Gestures and voice, same thing." |
| 4 | 19-24 s | Press Undo twice: the move north, then the turn, go back, in that order. | "Undo follows what I did, wherever I did it." |
| 5 | 24-36 s | Select the canopy with Select. The card shows Closed Brep, Roof::Canopy, 3.2 m³, Glulam and its user strings. Type "make this 200 mm thinner" in Ask about this and press Ask. Allow the script. The canopy changes and glows. | "Ask about this: the agent changes only what I selected, and shows me what it changed." |
| 6 | 36-40 s | Say "array 5 times". The bar says to ask the agent. | "What makes geometry is the agent's job, in the host." |

## Checks in a real Rhino (8.36), before posting

Each is task 5.1 of `openspec/changes/make-hai-the-edit-surface/tasks.md`; tick it there once seen.

- [ ] A move from HAI lands in Rhino where the preview put it, in a document in millimetres and in one in metres, and Rhino's Undo list shows one "HAI: Move" step.
- [ ] A rotation about the canopy's middle lands where the preview showed it, as one "HAI: Rotate" step.
- [ ] A delete from HAI is one step; HAI's Undo brings the object back (`host.undo`), and Redo deletes it again (`host.redo`).
- [ ] An edit of an object deleted in Rhino meanwhile is refused, and HAI's notice says so; the object goes back.
- [ ] Ask about this: the agent's run changes only the selected object, and anything else it touched is reported.
- [ ] Record the time from letting go to Rhino's result being drawn (target: within the mirror's 300 ms p90).
