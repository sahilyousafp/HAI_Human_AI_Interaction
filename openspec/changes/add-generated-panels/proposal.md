# Proposal

## Why

Some requests need numbers the user wants to feel out, not type once: a clearance between a wall and a column, a slab overhang within a tolerance, a spacing that must stay between 2.4 m and 3.0 m. A chat reply is the wrong tool for that, and a fixed tool palette cannot anticipate every project or every constraint. The agent can write a small piece of interface for exactly this task, but only if it can put it on screen safely, only when the user wants it, and without the user leaving the model to ask for it.

## What Changes

- **The agent offers a panel.** When a request is about tolerances, ranges or parameters, the agent asks whether the user wants a panel. The offer is a card in the agent panel: "Open a tolerance panel? Nod to open, shake to skip", with Open and Skip buttons.
- **A nod opens it.** The nod accepts that one offer. The panel shell appears at once, and the agent then writes the panel: one self-contained HTML document made for this project and this task (sliders, number fields with units, toggles, readouts).
- **The panel floats over the viewport and edits the model live.** Moving a control updates the model as it moves, before anything is saved. The Done button keeps the result as one undo step and closes the panel; Close puts the model back as it was.
- **The panel runs in a sandbox.** It cannot reach the network, the bridge, the session token, the rest of the page or the agent's tools. It can only read the scene and send validated scene operations, through the same schema every other edit uses.
- **The user closes it when done.** Close button, Escape or a hand press. The agent is told the panel was closed and whether the result was kept, and can answer in chat.
- **Both hands still work.** Hand presses reach controls inside the panel, and the model under the panel is not picked through it.

Out of scope: saving a panel with the project or reusing it in a later session; more than one panel at a time; panels that call the agent's tools, the network or the file system; panels inside Rhino itself (the same scene operations will drive Rhino through the Rhino connector, but its own window is later work); sharing panels between users; closing a panel by voice; the agent deciding to open a panel without the user's nod.

Demo clip (30-60 s): "My AI builds a panel for the job". Ask for a 150 mm clearance between a wall and a column with a tolerance. The agent offers a panel, a nod opens it, dragging the clearance slider moves the column live, the readout turns red outside tolerance, Done keeps it as one undo step, and the panel closes.

## Capabilities

### New Capabilities

- `generated-panel`: the offer, the nod to accept, the floating shell, the sandbox and its limits, the live preview and commit protocol, hand input inside the panel, closing and its report to the agent, and the panel tools the agent uses.

### Modified Capabilities

- `agent-panel`: an offer card in the turn, answered by click, nod or shake, with a stated order against the other nod and shake targets.
- `tool-approval`: the panel tools are pre-approved because the user's nod is the consent, and `open_panel` is refused unless an accepted offer is outstanding.

## Impact

- `packages/protocol`: panel offer, open, update, close and event messages; a panel-event schema reusing `SceneOp`.
- `apps/bridge`: four MCP tools (`offer_panel`, `open_panel`, `update_panel`, `close_panel`), offer gating state per agent, allow-sets for Architect and Product, a panel section in the agents' instructions, and the close report back to the agent.
- `apps/web`: the floating panel shell, the sandboxed frame and its injected runtime, a preview layer in the viewer, the offer card, and nod and shake routing.
- `docs`: `agent.md`, `agents.md`, `gestures.md`, `tools.md`, `SECURITY.md`.
- Relates to `add-agent-turn-review`, which also uses nod and shake: the order between them is set in this change's `agent-panel` delta, and a panel's Done counts as a direct edit for that change.
- Relates to `add-rhino-connector`: panels send scene operations only, so they work on whichever host owns the scene.
