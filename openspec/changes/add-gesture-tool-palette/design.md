# Design

## Context

Builds on `add-gesture-recognition` (pinch, clutch, nod and shake events), `add-gesture-viewport-navigation` (turntable controller, pointer, picking, scene transactions) and the bridge scene store. The agent arrives in the next change, so "Ask agent" degrades gracefully until then.

## Goals / Non-Goals

**Goals:**
- Picking a tool takes under a second for a practised user, with no precise aiming.
- Tools are plain modules, so new ones (Rhino, plugins) are cheap to add.

**Non-Goals:**
- Nested sub-menus (a flat 8-slot ring keeps directions memorable).
- Tool-specific gesture training.

## Decisions

**Marking-menu interaction** (Kurtenbach and Buxton). Open with a long pinch, steer and release. Novices see the ring and labels. Experts flick without looking because each slot keeps a fixed direction. Rejected: a fixed toolbar (needs precise aiming with a jittery hand pointer); a separate posture to open (more to learn, more false triggers).

**Hold detection in the pinch state machine.** `pinch.hold` fires once at 600 ms if movement stays under 2% of image width, then the same pinch continues as a drag. This keeps one pinch for open-steer-release, without a second gesture.

**Palette state machine** in the web app: `closed -> open(centre) -> highlighting(slot) -> closed`. While open, gesture drag events route to the palette instead of the navigation controller (the routing lives in one input router, so navigation never has to know about the palette). Slot index is `round(angle / 45 deg) mod 8`, active once beyond the 4% dead zone.

**Tool interface.**
```ts
interface Tool { id; label; icon; shortcut; activate?(ctx); deactivate?(ctx);
  onTap?(ctx, hit); onDragStart?(ctx, hit); onDrag?(ctx, delta); onDragEnd?(ctx);
  instant?: boolean /* undo, redo, ask agent: run and keep the previous tool */ }
```
The `ctx` gives scene transactions, picking, the HUD overlay layer and the confirmation helper. The registry is a simple map with a change event. Palette layout is `string[8]` of tool ids, stored in `.aex/settings.json` through the bridge so it follows the project folder. Rejected: browser storage (lost when switching browsers; the bridge already persists settings).

**Snapping and units.** Move snaps the delta to 100 mm on X and Y. Add massing snaps the centre to 100 mm. Measure rounds to 1 mm. All conversions to metres happen only at render time, as in the viewer.

**Section** uses a three.js clipping plane on element materials (`renderer.localClippingEnabled`) with a thin outline at the cut. The section height is shown in the HUD with a clear control.

**Confirmation helper.** Delete marks the element with a red highlight and listens for one nod, shake, Enter or Escape. The same helper is later reused by agent turn review.

**Latency budget.** Palette opens within one frame of the hold event, and slot highlighting updates every frame. This is measured with the existing gesture-to-render latency readout (p90 under 50 ms).

## Risks / Trade-offs

- [Long pinch collides with a slow, deliberate orbit start] → The 2% stillness rule. Orbit starts as soon as the hand moves, so a hold only happens when the hand is still.
- [Accidental tool change while resting the hand] → Engagement still gates everything; release in the centre cancels.
- [8 slots fill up as tools grow] → User-chosen layout. More tools stay available in settings without crowding the ring.
