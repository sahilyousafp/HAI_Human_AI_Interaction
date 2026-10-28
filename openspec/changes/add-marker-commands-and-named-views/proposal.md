# Proposal

## Why

Two things the earlier changes left out. A spoken "rotate 45 about marker B" went to the agent although the grammar knew everything but the marker, and the agent's `set_view` could not ask for Top or Front, so it could only show an elevation by guessing angles that the orthographic views now name exactly.

## What Changes

- **Markers in spoken commands.** "Rotate", "scale" and "mirror" take "about marker X" (or "at marker X"), and "move to marker X" takes the middle of what is selected, with its base, to the marker. A marker that is not placed is said so and nothing changes. Still all or nothing: "marker" without a single letter after it is the agent's.
- **`set_view` takes `view`**: top, bottom, front, back, left, right or perspective, as the view cube's faces. The camera switches at once, and framing or distance then animate from it. A named view sets the direction itself, so it is refused together with azimuth or elevation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `voice-input`: markers in spoken commands.
- `scene-tools`: the named view of `set_view`.

## Impact

- `packages/protocol`: `view` in `ViewRequest`, `VIEW_MODES` moves here from `packages/scene` (which re-exports it).
- `packages/scene`: a `moveTo` transform step.
- `apps/web`: the grammar, planner and runner read markers; the viewer handles `view`.
- `apps/bridge`: the `set_view` tool.
