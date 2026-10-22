# Design

## Context

The scene store already records each agent turn as one labelled transaction (`add-claude-agent-bridge`). The Rhino plugin is connected to the bridge and runs the agent's Python in Rhino, one undo record per run (`add-rhino-connector`). A turn can hold several runs, and a script may open undo records of its own, so HAI groups the turn itself.

## Goals / Non-Goals

**Goals:**
- Review appears within 200 ms of the turn ending.
- Reject is exact: the model returns to its pre-turn state, in the web scene and in Rhino.

**Non-Goals:**
- Merging concurrent edits made by the user during the agent turn (direct edits during a running turn are blocked with a "the agent is working" notice; the user can stop the turn first).

## Decisions

**Review = apply first, decide after.** Changes are applied live (the user watches the agent work), and the review decides afterwards whether to keep them. Rejected: staging changes as previews before applying (would need every tool, including a Python run, to support a dry-run mode, which arbitrary Python cannot).

**Web scene diff.** The turn transaction's op list classifies element ids as added (create), deleted (delete; the inverse op holds the full element for ghost rendering) or modified (update). Reject = undo that transaction, which is always the latest one, because direct edits during a turn are blocked and new activity accepts first.

**Rendering.** Added elements get an emissive teal overlay, modified ones amber, and deleted ones render from their stored state as translucent red ghosts, all through a review layer in the viewer that is removed on accept or reject. Colours come from the HUD palette tokens.

**Rhino grouping.** At turn start the bridge sends `rhino.turn.begin`. The plugin calls `doc.BeginUndoRecord("HAI: <request>")` and subscribes to `AddRhinoObject`, `DeleteRhinoObject`, `ReplaceRhinoObject` and `UndeleteRhinoObject`, recording object ids and (for deletes and replaces) duplicated geometry and attributes. At turn end, `rhino.turn.end` calls `EndUndoRecord` and reports the change summary. Reject calls `doc.Undo()` for that record. If Rhino reports that nested records prevented grouping (each Python run opens its own record, and a script may open more), the plugin falls back to an exact manual revert: delete added objects, restore deleted ones from the stored copies, and replace modified ones with their stored copies, inside one new undo record. A spike task confirms which path Rhino 8 takes with several Python runs in one turn.

**Confirmation.** Reuses the confirmation helper from the palette's Delete tool (nod, shake, Enter, Escape, buttons), so every yes/no in the app behaves the same.

**Policy.** Stored with the project settings in `.hai/settings.json`: `review: "always" | "deletions" | "never"`.

## Risks / Trade-offs

- [Nested undo records in Rhino break one-step grouping] → Manual exact revert fallback, covered by a spike and a manual test script.
- [Very large turns (thousands of objects) make ghost rendering slow] → Cap ghost rendering at 500 deleted elements and show the count for the rest; reject still reverts everything.
- [Users accept by habit without looking] → The default policy reviews every turn, and the card shows counts so deletions stand out.
