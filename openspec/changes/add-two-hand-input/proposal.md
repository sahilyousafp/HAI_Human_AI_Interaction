## Why

HAI behaves like a computer with one mouse. The right hand is the pointer: hover, button highlights and "this" for voice follow it, while the left hand only gets a grey ring. Under the surface the recognizer already treats both hands alike, but the tools have room for one palette, one drag and one hover, gesture settings have no hand dimension, and the hands cannot reach the sidebar or scroll anything. The agent stop (two open palms) also fires by accident: just showing both hands to the camera triggers it, as the maintainer's own demo clip shows. Nothing lets the user make geometry by hand beyond a fixed massing block.

## What Changes

- **Both hands are equal pointers.**
  - Each visible hand gets a full pointer, in its colour in the camera overlay.
  - Each hand hovers, presses and scrolls.
  - Hover in the model and what "this" and "here" mean follow the focus hand: the one that pinched last.
- **The hands reach the whole page.**
  - Pointers span the workspace (the model and the sidebar).
  - A pinch presses whatever the mouse clicks: buttons, links, checkboxes and their labels.
- **Scrolling by hand.** A pinch-drag on a scrolled area scrolls it with the hand, and a quick release coasts on.
- **Each hand interacts on its own.**
  - Each hand has its own press, scroll and ring.
  - The active tool takes one hand's drag at a time, and the other hand keeps working.
  - Two pinches are a two-hand navigation gesture only when they start together, or while neither hand is busy. **BREAKING** for anyone who pinched one hand, held it, then pinched the other to zoom: that still works while the first hand is still, but not once it holds a ring or drags.
- **A long pinch opens a ring per hand.**
  - The right hand opens the tools ring, and the left hand opens a new create ring.
  - Each ring's layout is edited in its own tab and stored in the workspace settings (`palette`, plus the new `createPalette`).
  - Shift+Space and Shift with a held right button open the create ring.
- **Gesture settings are per hand.**
  - Tap, long pinch, drag and fist are set for each hand.
  - The bindings are stored as `tap.left`, `tap.right` and so on.
  - Older settings still load. **BREAKING** for anything reading the stored bindings: the slot `palms` became `stop`, and the action `palette` became `tools-ring` / `create-ring`.
- **Basic create tools.**
  - Wall (W): drag on the ground.
  - Slab (F): drag between corners.
  - Column (C): a tap.
  - Copy (P): drag an element.
  - Each shows a draft while drawing, snaps to 100 mm, and is one undo step.
  - The create ring holds them by default, with Massing, Undo, Redo and Delete.
- **Stop is two fists, then open hands.**
  - Both hands held as fists for 250 ms arm the stop, and both palms opened within 1 s fire it.
  - Open palms alone never stop. While both hands are fists, neither hand's fist action runs.
  - The HUD says "Open both hands to stop" while armed. **BREAKING**: `palms.stop` became `hands.stop`.

## Capabilities

### New Capabilities

None: everything extends existing capabilities.

### Modified Capabilities

- `gesture-recognition`:
  - the two-hand pinch starts only when the pinches begin together or neither hand is busy;
  - the two-palm stop is replaced by two fists, then open hands;
  - gesture actions are set per hand.
- `viewport-navigation`: both hands are pointers with a focus hand, and the grey second pointer is gone.
- `tool-palette`:
  - a ring per hand;
  - pointers per hand;
  - pressing anything clickable anywhere on the page;
  - scrolling by hand;
  - the create ring's keys and layout.
- `direct-tools`: the Wall, Slab, Column and Copy tools.
- `agent-panel`, `agent-team`, `spoken-replies`: the stop gesture's new form.

## Impact

- **packages/protocol**:
  - `gestures.ts`: `hands.stop`.
  - `bindings.ts`: per-hand bindings, legacy migration, and the `actionFor` helper.
  - `messages.ts`: `createPalette`.
- **packages/perception**:
  - `recognizer.ts`: the stop sequence, the two-hand start rule, and `stopArmed`.
  - `hand-machine.ts`: `holdEmitted`, `dragging` and `pinchStartTs`.
  - `config.ts`: `twoHand.startWindowMs` and `stop.fistsMs` / `stop.openMs`, replacing `stop.palmsMs`.
- **apps/web**:
  - `input-bus.ts`: per-hand pointer samples and the armed stop.
  - `TrackingPanel.tsx`.
  - `Viewer.tsx`: workspace mapping, page-wide pressing and scrolling, two pointers, and draft rendering.
  - `controller.ts`: per-pointer grabs and two rings.
  - `input-router.ts`.
  - `create.ts` and `grid.ts` (new).
  - `hand-scroll.ts` (new).
  - `GestureSettingsCard.tsx`, `ToolOverlays.tsx`, `App.tsx`, `styles.css`.
- **apps/bridge**: `settings.ts` stores `createPalette`.
- **Docs**: `docs/gestures.md`, `docs/tools.md`, `docs/navigation.md`, `docs/agent.md`, `docs/agents.md`, `docs/voice.md`, and the new demo `demos/09-two-hands.md`.
- **E2E**:
  - Tests now ask the page for the inverse pointer mapping (`__HAI_VIEWER__.handAt`), because pointers span the workspace.
  - The pointer test ids are `hand-pointer-left` and `hand-pointer-right`.
  - The Gestures card's per-hand selects are `gesture-<slot>-left` and `gesture-<slot>-right`.

Demo clip (Week 9): "Both hands": the left hand opens the create ring and draws two walls and a slab while the right hand orbits and selects; "make this 300 thick"; both fists, then open hands, stop Mochi mid-task.
