# Tasks

## 1. Protocol and offer state

- [x] 1.1 Add `panel.offer`, `panel.offer.answer`, `panel.open`, `panel.update`, `panel.close` and `panel.closed` messages in `packages/protocol`, and a `panelEvent` schema for what a panel may send (`preview`, `commit`, `get`, `press` replies) built on `SceneOp`; verify schema unit tests accept valid and reject invalid messages, including a 256 KB limit on the document
- [x] 1.2 Add the Generated panels feature in `packages/protocol/src/features.ts` (on by default); verify the features unit test and the settings sheet list it
- [x] 1.3 Implement the per-agent offer state machine in `apps/bridge` (`none`, `waiting`, `accepted`, `open`), one panel at a time across agents, 60 s expiry, and denial when a turn is stopped; verify unit tests for each transition and the refusals "panel without an accepted offer", "second panel", "offer while open", "offer expires"

## 2. Agent tools

- [x] 2.1 Register `offer_panel` (blocks until answered, returns accepted, skipped or expired), `open_panel` (returns ready or failed with the reason), `update_panel` and `close_panel` in `apps/bridge/src/mcp/scene-tools.ts`, with the panel API documented in the `open_panel` description; verify unit tests through the MCP client, including "oversized document" and "supply without acceptance"
- [x] 2.2 Grant the four tools to every agent marked as writing in `allowedHaiTools` (`roster.ts`) regardless of its definition file, remove them when the Generated panels feature is off, and make sure the agent's `--allowedTools` and MCP configuration include them; verify "Reviewer cannot offer", "switched off", and that an existing project's unchanged Architect file still gets the tools
- [x] 2.3 Deliver the close note ("panel closed, result kept or discarded") to the agent that opened the panel as a turn when it is idle, queued like Mochi's report; verify with the fake agent CLI that the agent receives it once, after the user presses Done and after Close
- [x] 2.4 Document the tools, the offer flow and the close note in `docs/agent.md` and `docs/agents.md`; verify the docs tests that check the tool tables still pass

## 3. Panel shell in the viewer

- [x] 3.1 Build the floating `GeneratedPanel` shell in `apps/web` (header with title and drag handle, Done and Close in a footer outside the frame, loading and failed states, stays inside the window, z-order between the camera view and the settings sheet, hand-pressable controls with `data-hand-press`); verify component tests and Playwright "Move the panel" and "Panel cannot hide the frame controls"
- [x] 3.2 Make the viewer treat the panel as HUD so the model beneath is not picked and navigation outside it is unaffected; verify Playwright "Nothing picked through the panel", "Navigation continues" and "Orbit while the panel loads"
- [x] 3.3 Add the offer card to `AgentPanel` (Open and Skip, Opened, Skipped, Expired states, under the hand-off chip for a specialist's offer, counted in the collapsed header) and the loading frame that appears on acceptance; verify Playwright "Offer is shown", "Frame appears before the content" within 150 ms, "Skip", "Specialist offer is findable" and "Waiting offer while collapsed"
- [x] 3.4 Route nod and shake to the offer in the answer chain in `App.tsx` and `input-router.ts` in the order voice transcript, approval card, offer, other confirmation, without cancelling the active tool on a shake; verify the "Nod opens the panel", "Shake skips and keeps the tool", "Approval is answered before the offer" and "Transcript is answered before the offer" scenarios with injected gesture events
- [x] 3.5 Document the offer card and the answer order in `docs/gestures.md` and `docs/tools.md`; verify the docs test that checks the gesture tables passes

## 4. Sandbox and runtime

- [x] 4.1 Build the frame document: sandbox flags, `csp` attribute and in-document CSP, the HUD tokens and base stylesheet, the injected `hai` runtime, and the MessageChannel handshake; verify unit tests on the generated markup and Playwright "Theme follows the app"
- [x] 4.2 Validate every port message with the protocol schemas, apply the 60 messages per second limit with a message back to the panel, and report load failures and script errors to the host; verify "Invalid operation", "Flooding is limited" and "A broken panel does not break the app"
- [x] 4.3 Write a hostile-panel Playwright test: a panel that reads `window.parent.__HAI_SESSION__`, calls fetch on an outside address and on the bridge, tries `top.location`, `window.open`, a form post and nested frames, and sends malformed operations; verify every attempt fails, no request leaves the page (reuse the request-capture helper from the privacy tests) and the app keeps working
- [x] 4.4 Document the sandbox, its limits and what a panel can do in `SECURITY.md` and `docs/agent.md`; verify every limit stated there is covered by a test from 4.2 or 4.3

## 5. Live preview and commit

- [x] 5.1 Add the preview layer to the viewer: apply `applyTransaction(doc, previewOps)` at most once per frame, re-apply over incoming patches, drop and report a preview that no longer applies; verify unit tests and Playwright "Slider moves the column live" and "Agent does not see previews"
- [x] 5.2 Implement `hai.scene.get`, `hai.selection` and the change events; verify "Panel reads the scene" and that events arrive after a scene patch and a selection change
- [x] 5.3 Implement commit (Done and `hai.commit()`) as one `scene.apply` labelled with the panel's title, Close and replace discarding the preview, and closing on connection loss or when the feature is switched off; verify "Done commits once", "Close discards", "Commit from the panel twice", "Preview leaves no history", "Replace discards preview", "Connection lost" and "Switched off while open"
- [x] 5.4 Keep the panel open when its turn is stopped or ends, and let the agent close it; verify "Stop does not close the panel" and "Agent closes the panel"

## 6. Hand input inside the panel

- [x] 6.1 Forward hand presses over the frame to the runtime in frame coordinates, and implement button, checkbox, radio and range handling there, with a minimum control size in the base stylesheet; verify Playwright with injected hand events: "Press a button inside the panel" and a hand-dragged range moves like a mouse-dragged one
- [x] 6.2 Add Escape-to-close while the panel has focus (the runtime forwards the key), and the hand press on Close; verify "Close with Escape" and "Press Close by hand"
- [x] 6.3 Document hand input in panels (which controls work by hand, which do not) in the `open_panel` description and `docs/gestures.md`; verify the description lists exactly the controls the tests in 6.1 cover

## 7. Real agent and demo

- [ ] 7.1 Run the real agent once end to end on the sample project: ask for a wall to column clearance with a tolerance, confirm it offers, a nod opens a panel it wrote, the slider moves the column, and Done keeps it; record what the panel looked like and any HTML the agent got wrong into `docs/decisions.md`, and tighten the `open_panel` description if so
- [ ] 7.2 Write `demos/15b-generated-panel.md` (setup, shot list for the clip "My AI builds a panel for the job", real-camera checks, post-recording checks) and add the clip to `docs/PLAN.md`; verify the script follows the template of `demos/12b-fist-pan.md` and that every step in it was done once on the real camera
