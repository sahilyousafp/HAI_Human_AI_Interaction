# Proposal

## Why

Three things about the chat made working with agents harder. A permission request was only a card in the chat rail, far from the model it concerned, and easy to miss with the rail collapsed. Agents wrote long replies that were also read aloud in full. And holding to talk while the agent was speaking did not take priority: the voice was stopped, but the rest of that reply started speaking again as it arrived.

## What Changes

- **Permission requests in the model.** A pulsing badge in the asking agent's colour sits on top of what the request concerns (the elements its input names, else the agent's own, else the model). A pinch opens a tag with Allow and Deny; nod and shake still answer. A request that runs a script keeps its decision in the chat card, so the script is read first.
- **Short replies.** The agent's instructions ask for one or two plain sentences with no lists or recap. A finished reply over about 320 characters shows its first sentences with Show more, and only its first three sentences are spoken.
- **Listening comes first.** While the microphone is open for the user the voice is silent, and the rest of a reply it had begun is not spoken, as is the rest of any reply stopped by Stop. The chat marks where the reply was cut and offers Read the rest aloud.
- **Settings > Chat rail.** What the collapsed rail shows and in what order of priority: Quiet, Needs you first (the default), Team or a custom list of six items. A request waiting for the user, when listed first, takes the strip over. When the strip is short the lower items drop first.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-panel`: the collapsed strip's contents, and the cut for long replies.
- `tool-approval`: the request in the model.
- `spoken-replies`: listening first, the spoken limit, and reading on.

## Impact

- `packages/protocol`: `StripLayout`, `STRIP_PRESETS` and the `railStrip` setting.
- `apps/bridge`: the setting's storage; the agent's instructions.
- `apps/web`: `ApprovalBadges`, `approvalAnchor`, `CollapsedStrip` and `planStrip`, `RailSettings`, the Speaker, the reply cut.
