# Proposal

## Why

The chat was a 380 px card floating over the model, under the project bar, and it had grown crowded. Four problems stood out:

- **The header was crowded.** It held the name, the status, the Chat, Agents and Extensions tabs and the collapse button in one tight row.
- **The transcript had no rhythm.** Replies, tool chips, team updates and approval cards ran together with uneven gaps.
- **The input row was cramped.** The microphone, the speak toggle, the text box and send shared one row, and the voice bar, written files and run reports stacked above it.
- **The team strip and plan card pushed the conversation down.** The team chips wrapped onto two lines.

## What Changes

- **The chat is a docked rail down the left of the workspace**, full height, beside the model instead of over it.
  - The model view starts at the rail's edge, and the project bar and status strip stay over the model.
  - The rail's width can be dragged between 320 and 560 px (380 by default), changed with the arrow keys, reset with a double-click, and stepped through by a press, since a hand cannot drag. The width is remembered.
  - Collapsed, it is a 52 px strip: expand, the status, the name, what waits for approval and the microphone.
  - On narrow screens (860 px and below) it is a sheet over the bottom of the model, half its height at most.
- **The header has two rows.** The first holds the name, the status and collapse; the second holds the Chat, Agents and Extensions tabs, full width at 40 px for a hand.
- **The team is one row of chips that scrolls sideways**, with the summary and Stop all pinned at its end once work is under way.
- **A settled plan folds to one line**, such as "Plan: 2 of 3 parts, Architect, Product", that opens in place. A plan waiting for an answer stays open.
- **The transcript follows one spacing scale.**
  - Turns are 24 px apart, and items within a turn 8 px apart.
  - Everything the agent says or does sits 16 px in, under a dot on its first reply line.
  - Team updates are a tinted block.
- **Several tool calls in a row are one steps line**, for example "3 steps, done", "2 steps, 1 running", "Bash needs approval" or "4 steps, 1 failed".
  - The line opens while a call runs, waits for approval or has failed, and stays folded once all are done.
  - A single call is still a single chip, and approval and panel-offer cards follow the line they belong to.
- **Written files and run reports share one tray row above the input**, "Files and runs (n)". It opens when new ones arrive.
- **The input is one field in two rows.**
  - The text box comes first, full width, growing to six lines.
  - The microphone, the speak toggle and send (or stop) sit beneath it.
  - A voice request under way (starting, listening, writing it down, or waiting to be sent) takes the field's first row in place of the text box.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-panel`: the panel is a docked, resizable rail. Consecutive tool calls group into one steps line. Collapsing leaves a strip.

## Impact

- `apps/web/src/App.tsx`: the panel renders in the workspace beside the stage, not inside the viewer.
- `apps/web/src/agent/AgentPanel.tsx`: the header, the team row, the plan summary, the steps group, the tray, the composer, the collapsed strip and the resize handle.
- `apps/web/src/styles.css`: the workspace grid and the rail's styles, including the sheet on narrow screens.
- Every test id, ARIA attribute and hand-press marker is kept, so the agent, voice and team specs run unchanged. The visual baselines that show the panel or the model's width are refreshed.
