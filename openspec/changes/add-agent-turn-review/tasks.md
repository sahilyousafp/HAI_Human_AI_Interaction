# Tasks

## 1. Review core (web scene)

- [ ] 1.1 Add review and turn-boundary messages in `packages/protocol`; verify schema unit tests
- [ ] 1.2 Compute the turn diff (added, modified, deleted) from the turn transaction in the bridge and start a review only for changed turns; verify "review after adding columns" (counts) and "no review for read-only turns" with the fake agent CLI
- [ ] 1.3 Implement accept and reject (reject undoes the turn transaction) and block direct edits while a turn runs; verify "nod accepts" and "shake rejects" with injected gesture events
- [ ] 1.4 Implement implicit accept on new request or direct edit, with the notice; verify "new request accepts"
- [ ] 1.5 Add the review policy setting persisted per project; verify "deletions only"

## 2. Review rendering

- [ ] 2.1 Render the review layer (teal added, amber modified, red ghosts for deleted, 500-ghost cap) and the summary card; verify Playwright screenshot baselines in light and dark

## 3. Rhino

- [ ] 3.1 Spike: in Rhino 8 with RhinoAI, confirm whether `BeginUndoRecord`/`EndUndoRecord` around a turn groups RhinoAI's changes into one undo; record the result in `docs/decisions.md`
- [ ] 3.2 Implement turn begin and end in the plugin with change tracking and conduit highlighting; verify highlight colours match the web review in the manual script
- [ ] 3.3 Implement reject via `doc.Undo()` with the exact manual revert fallback; verify "reject in Rhino" and "one undo in Rhino" by the manual script, and unit-test the fallback bookkeeping in `AEX.Rhino.Core`

## 4. Docs

- [ ] 4.1 Document review, policy and Rhino behaviour in `docs/review.md`; verify every gesture and key listed works in the demo script

## 5. Demo

- [ ] 5.1 Write `demos/12-turn-review.md` (ask for a colonnade, see highlights, shake to reject, rephrase, nod to accept, then the same in Rhino) and record the clip; verify reject leaves both the web scene and the Rhino document exactly as before the turn
