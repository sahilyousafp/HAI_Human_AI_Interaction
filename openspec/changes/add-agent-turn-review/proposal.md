# Proposal

## Why

When an agent edits a model, the user needs to see exactly what changed and decide quickly whether to keep it. Scrolling a chat log or hunting through an undo history breaks the flow. A review step that highlights the turn's changes in the model, and accepts or reverts them with a nod or a shake, makes the agent safe to use on real work, in the built-in viewer and in Rhino.

## What Changes

- After every agent turn that changed the model, a review starts: added elements are highlighted in teal, modified ones in amber, and deleted ones remain as red ghosts. A summary card shows the counts ("4 added, 1 changed, 0 deleted").
- Accept (nod, click or Enter) keeps the changes. Reject (shake, click or Escape) reverts the whole turn in one step.
- Starting a new request, or editing the model directly, accepts the pending review, and the HUD says so. The turn can still be undone later.
- In Rhino, all document changes made during an agent turn, including those made by RhinoAI's tools, are grouped so one reject or one undo reverts the whole turn. They are highlighted with a display conduit during review.
- A review policy setting: review every turn (default), review only turns that delete something, or never review.

Out of scope: partial accept (keeping some changes of a turn and not others), side-by-side before and after views, reviewing non-model actions such as files written by the agent (those already go through tool approval).

Demo clip (Week 12): "The agent proposes, I nod to accept": ask for a colonnade, see the new columns glow, shake to reject, rephrase, nod to accept. Same thing in Rhino.

## Capabilities

### New Capabilities

- `agent-turn-review`: highlighting a turn's changes, accepting or rejecting them as a unit, implicit acceptance, the review policy, and turn grouping in Rhino.

### Modified Capabilities

None. It builds on `scene-tools` (one turn, one transaction) and `rhino-link` without changing their requirements.

## Impact

- `apps/bridge`: review state per turn, diff of the turn transaction, accept and reject handling, Rhino turn begin and end signals.
- `apps/web`: highlight materials, ghost rendering of deleted elements, summary card, policy setting.
- `plugins/rhino`: undo record grouping per turn, change tracking, conduit highlighting, revert.
- `packages/protocol`: review and turn-boundary messages.
- Reuses the confirmation helper from `add-gesture-tool-palette`.
