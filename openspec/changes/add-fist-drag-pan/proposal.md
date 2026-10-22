# Proposal

## Why

Panning by hand is hard to find and hard to do. The only ways today are a two-hand pinch (both pinches must start within 300 ms, and it also zooms and turns the view by accident) or setting one hand's pinch-drag to pan in Settings, which gives up orbiting on that hand. Grabbing the view and moving it is the most natural way to pan, and a closed hand is the natural grab. Today a fist is only a clutch (a pause) and a cancel after 600 ms, so it is free to carry a deliberate move.

## What Changes

- **A moving fist pans the view.**
  - Close a hand into a fist and move it: the model follows the hand, like grabbing a map.
  - Releasing while still moving coasts on, like every other navigation gesture.
  - It works with either hand, and a new per-hand gesture setting, **Fist drag**, can change it to orbit or to nothing (default: pan).
- **A still fist is a hold, and a longer one.**
  - A fist that stays still for 1.5 s still runs the fist action (cancel, back to Select, by default). It was 600 ms.
  - A fist that moves never runs it, so panning never cancels the tool.
  - The setting is renamed **Fist hold** in the Gestures card.
- **The clutch keeps its job.**
  - A hand that closes into a fist while it is dragging (a pinch drag, a tool, a ring) is still a clutch: moving that fist moves nothing, so the user can reposition and pinch again.
  - A fist-drag starts only from a fist closed at rest, then moved.
- **The hand pointer shows pan.**
  - While a hand is a fist that would pan, its pointer shows a four-arrow pan icon; the icon fills in while the view is moving.
  - A pinch drag that is set to pan shows the same icon while it moves.
- **Both fists are still the stop.** With both hands in fists neither pans: a fist-drag in progress ends when the second hand closes, and the stop gesture is unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `gesture-recognition`:
  - A moving fist is reported as a fist drag, with the clutch events unchanged.
  - A fist that closes mid-drag is a clutch and never a fist drag.
  - "Fist drag" is a per-hand gesture setting, and the fist setting is described as a hold.
- `viewport-navigation`: a fist drag pans (or orbits, if set so) the view, and coasts when released.
- `tool-palette`: the fist hold takes 1.5 s, and a moving fist never cancels; the hand pointer shows pan.

## Impact

- **packages/protocol**:
  - `gestures.ts`: `fist.drag.start`, `.update` and `.end`.
  - `bindings.ts`: the `fistdrag` slot (per hand: `pan`, `orbit`, `none`; default `pan`), and the `fist` slot's wording. Stored settings stay valid: no key is renamed.
- **packages/perception**:
  - `hand-machine.ts`: fist movement tracking, and the rules for when a fist may drag.
  - `features.ts`: `palmPoint`, a steadier hand point for a closed hand (see design.md).
  - `config.ts`: `clutch.moveMin`.
  - `recognizer.ts`: feeds the palm point and whether both hands are fists to each hand.
- **apps/web**:
  - `input-router.ts`: routes the fist drag to navigation, cancels the fist hold when it starts, and keeps it off while both hands are fists.
  - `controller.ts`: `FIST_RESET_MS` from 600 to 1500.
  - `navigation.ts`: handles the fist drag events and the flick on release.
  - `Viewer.tsx`, `styles.css`: the pan pointer, from the clutch and navigation events the viewer already gets.
  - `GestureSettingsCard.tsx`: the Fist drag row, its detection light, and the Fist hold wording.
- **Docs**: `docs/gestures.md`, `docs/navigation.md`, `docs/tools.md`, `docs/settings.md`, and the new demo `demos/12b-fist-pan.md`.
- **E2E**: a new `e2e/fist-pan.spec.ts`, and updates to specs that hold a fist for about 600 ms.

## Out of scope

- The mouse cursor (the browser pointer) while panning with the right or middle button; this change is about the hand pointer.
- Two-hand pan, zoom and turn: unchanged.
- An open hand as a pan gesture (rejected, see design.md).
- Fist pan for non-viewer hosts such as Rhino; the Rhino connector reuses the gesture events later.
- A fist-drag for scrolling lists, or pressing buttons.

## Demo

A 30-45 s clip, "Grab the view": engage, close the left hand and drag it to slide a building across the screen, flick it to coast; keep the right hand orbiting with a pinch; hold a fist still for 1.5 s and watch the tool snap back to Select. Script: `demos/12b-fist-pan.md`.
