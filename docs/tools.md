# Tools and the tool palette

Many design actions are faster done directly than through the agent: measure a facade, cut a section, nudge a block. The tool palette puts them under your hand. None of these tools need the agent, and every change they make is an ordinary scene transaction, so Undo always reverses it.

## Opening the palette

| How | Do |
|---|---|
| Hand | Engage (open palm), then pinch and keep the hand still for a moment (a long pinch). The palette opens around your hand |
| Keyboard | Hold Space. The palette opens at the mouse pointer |
| Mouse | Hold the right button without moving. A right button drag still pans the view |

Then move toward a tool and release (the pinch, Space or the right button). The tool in that direction is highlighted once you are outside the small circle in the middle (4% of the image width); release there to cancel. Each slot keeps its direction, so with practice a quick flick picks a tool without looking.

While the palette is open, the view does not move. A long pinch while you are holding something (an element with Move, the section plane with Section) keeps holding it instead of opening the palette.

## Getting back out, and the HUD by hand

The active tool is always shown at the bottom left of the view. To leave it and return to Select:

- press its **x** button (with the mouse, or with a hand: point at it and tap with a quick pinch),
- press Escape,
- shake your head,
- or hold a closed fist for 600 ms.

Escape and a head shake first close an open palette, answer "keep" to a question, or drop a drag in progress; the next one returns to Select.

Every button over the view (Undo, Redo, the cancel x, Remove section, Delete and Keep) can be pressed by hand: point at it so it gets an outline and the pointer shrinks to a dot, then pinch and let go. Any pinch that starts on a button presses it, however long you hold it; it never grabs or orbits. After an undo or redo, a strip says what was undone and offers **Undo again** and **Redo**, so stepping back several changes takes a few taps.

## The pointer

The hand pointer shows what a pinch would do where it is:

| Pointer | Meaning |
|---|---|
| Plain ring | Select: tap selects, a drag orbits |
| Ring with the tool's icon (red for Delete) | The active tool acts here |
| Rounded square with up and down arrows | Over the section plane (with Section) or its outline (with any tool): pinch to grab it and drag |
| Small dot | Over a button (tap to press), or the palette is open (steer and release) |
| Dashed grey ring | Tracking sees your hand but you are not engaged: show an open palm |

The mouse cursor changes with the tool as well. The pointer stays put through brief tracking dropouts instead of blinking out.

## Tools

| Tool | Key | Default slot | What it does |
|---|---|---|---|
| Select | V | Top | Tap selects the element under the pointer; tap on empty space clears. Drags orbit the view |
| Ask agent | A | Top right | Opens the agent panel with the cursor in its input (see [agent.md](agent.md)). If the agent is not available, it says why |
| Measure | D | Right | Tap two points on the model: the distance between them is shown in millimetres (rounded to 1 mm). Changes nothing |
| Section | S | Bottom right | The cut is a plane you can grab: pinch on it (it lights up under the pointer) and drag down to cut lower, up to cut higher; the height is shown in millimetres. A drag off the plane orbits. The section stays when you change tool, until you press Remove (or tap the plane with Delete). From any other tool, its outline can still be grabbed and dragged, and tapping the outline selects the section |
| Move | M | Bottom | Pinch an element and drag it along the ground; it snaps to 100 mm and is moved in one "Move" transaction when you let go. A drag that starts on empty space orbits instead |
| Add massing | B | Bottom left | Tap the ground: a 6000 x 6000 x 3500 mm block is placed there, centred on the tap and snapped to 100 mm |
| Delete | X | Left | Tap an element: it turns red and asks you to confirm. Nod or press Enter to delete it; shake your head or press Escape to keep it. Tapping the section plane removes the section |
| Undo | U | Top left | Undoes the last change at once and keeps your current tool; Undo again on the strip that appears steps further back |
| Redo | R | (not in the ring) | Redoes at once and keeps your current tool |

Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y keep working as before.

## Choosing the layout

The **Tool palette** card in the sidebar lists the eight slots, clockwise from the top. Pick any registered tool for each slot, or leave it empty. The layout is saved by the bridge in `.aex/settings.json` in the workspace, so it is the same in every browser and after a restart.

## Adding a tool

Tools are plain objects registered in the tool registry (`apps/web/src/tools/registry.ts`). A registered tool can be placed in any slot and gets its keyboard shortcut straight away; the palette itself needs no change. The Rhino connector and plugins add their tools this way.

```ts
import type { Tool } from "./tools/types.ts";

const bakeTool: Tool = {
  id: "rhino-bake",
  label: "Bake to Rhino",
  icon: "M4 4h16v16H4z", // SVG path data for a 24 x 24 stroked icon
  shortcut: "k", // one key, not used by another tool
  onTap(ctx, _at, hit) {
    if (hit) ctx.flash(`Baking ${hit.elementId}`);
  },
};
registry.register(bakeTool);
```

A tool can implement any of these; the `ctx` it receives reads and changes the scene (`doc`, `apply`, `undo`, `redo`, `select`), looks into the view (`pick`, `ground`, `bounds`), draws on it (`overlay`, `setOverlay`, `flash`) and asks for confirmation (`confirm`).

| Member | When it is called |
|---|---|
| `activate`, `deactivate` | The tool becomes active, or another tool does |
| `onHover(ctx, at)` | The pointer moved (hand or mouse), for hover feedback |
| `onTap(ctx, at, hit)` | A tap or click; `hit` is the element and point under it, or null |
| `onDragStart(ctx, at, hit)` | A drag begins. Return true to take it; otherwise the view orbits |
| `onDrag`, `onDragEnd` | The drag moves and ends |
| `onDragCancel` | The drag was taken over (the palette opened) or the user disengaged: undo any preview, commit nothing |
| `instant` and `run(ctx)` | Instant tools (like Undo) run once and leave the current tool active |

Positions (`at`) are viewer coordinates, 0 to 1 across and down the 3D view, whether they come from a hand, the mouse or a test.
