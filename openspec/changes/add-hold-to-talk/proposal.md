# Proposal

## Why

The long pinch and its two rings were designed when hands were the main way to build and the agent sat in a side panel. Now Mochi and the specialists do most of the building, by voice, with generated panels for tuning. Yet the long pinch still only opens rings of fixed-size element tools, a ring slot is spent on Ask agent, Undo and Delete appear in both rings, and no spoken word can pick a tool without a full LLM turn. Hands are best at pointing out *what* and *where*, and voice is best at saying *what to do*: the long pinch should join the two ("put that there").

## What Changes

- **BREAKING (default behaviour):** a long pinch with either hand now starts **hold to talk about this**. A progress ring fills around the hand, the target under the pinch is locked (an element, else a snapped point, else the ground point), and the microphone listens only while the pinch is held. Releasing sends the request at once, with no countdown, because the hold was the deliberate act. A head shake within 1.5 s after sending stops it.
- While holding and speaking, the hand points: elements it rests on are captured as today, and so are the snapped **points** it rests on, so "copy this there" and "a canopy from here to here" work.
- **The ring becomes the silent fallback inside the same hold.** If no speech starts within 600 ms of the hold, the ring fades in, and a flick with no speech picks a slot as before. Speech always wins: once speech starts, the ring hides and movement is pointing.
- **The two rings are reorganised by role, not by element type**, following the non-dominant/dominant split of two-handed work:
  - The **action ring** (dominant hand) holds Select, Move, Copy, Delete, Wall, Slab, Column and Undo.
  - The **reference ring** (other hand) holds Sketch line, Sketch area, Place marker, Measure, Add massing and Section, with two slots free for the modelling tools of week 14.
  - Ask agent, Redo and the duplicates leave the default rings (Ask agent and Redo keep their keys, and Redo stays on the undo strip and in voice).
- **A Dominant hand setting** (right by default) decides which hand's hold falls back to which ring, so the defaults suit left-handed users too.
- **New reference tools** whose output is context for the agent, not model elements: **Sketch line** (a path), **Sketch area** (a closed outline) and **Place marker** (a lettered point, A to Z, kept with the project). Requests carry them, so "a wall along this", "a canopy over this" and "the entrance at marker B" work.
- **Tool names by voice without the agent:** a transcript that is only a tool's spoken name ("wall", "sketch area", "measure", "undo") picks that tool at once and is never sent. Each tool declares its spoken names; ring slots show them, so the ring teaches the words. Every tool in both rings, and any tool registered later, can be picked this way.
- Requests carry the locked target, the points, the sketches and the markers alongside the existing references, and `get_user_context` returns them.
- Settings still holding the old default layouts or the old default hold bindings move to the new defaults; custom layouts and bindings are kept.
- Local counters in the HUD Detection card (holds, holds with speech, flicks per ring and cancels) give tuning data. They are never sent anywhere.
- A spike measures false holds and time to first speech at hold times of 500, 650 and 800 ms on the reference laptop before the default `holdMs` changes.

Out of scope:
- Adaptive or agent-suggested ring slots. The slots stay fixed and only the user changes them.
- Accept and Reject in the rings. The agent turn review keeps nod, shake, Enter and Escape.
- Letting the agent set the user's tool or change the rings.
- Sketches as model elements or as Rhino geometry.
- A handedness setting for anything other than the rings (navigation bindings stay per hand as today).
- Custom gesture training.

Demo clip (about 45 s, "Point, hold, speak"):
1. Hold a pinch on a wall, say "make this 300 thick", let go, and the wall changes.
2. With the left hand, flick the reference ring silently to Sketch area and outline a courtyard. Then hold and say "Architect, a canopy over this".
3. Say just "measure", and Measure is active at once with no agent turn.
4. End on a left-handed user switching Dominant hand.

## Capabilities

### New Capabilities

- `hold-to-talk`: the held-pinch request (progress, locked target, listening while held, pointing at points while speaking, sending on release, stopping by shake), the silent ring fallback with flick, the Dominant hand setting, and the local counters.

### Modified Capabilities

- `tool-palette`: a long pinch starts hold to talk by default; the two rings become the action ring and the reference ring with new defaults; rings show spoken names; new shortcuts; migration of old default layouts.
- `direct-tools`: adds Sketch line, Sketch area and Place marker; tools declare spoken names.
- `voice-input`: holding a pinch is an explicit way to listen; a transcript that is only a tool name picks the tool without the agent.
- `multimodal-intent`: requests carry the locked target, the captured points, the sketches and the markers.

## Impact

- `packages/perception`: no change to detection; `holdMs` stays configurable (the spike may change its default).
- `packages/protocol`: new binding action `talk`, `dominantHand`, new default palettes, migration; utterance context and request message gain `target`, `points`, `sketches` and `markers`; marker storage messages.
- `apps/web`:
  - `tools/input-router.ts` gets the hold state machine: talk, then the silent ring fallback, then a flick. It reuses `PaletteMachine` and `slotAt` from `tools/palette.ts`.
  - `voice/` gets listening scoped to the hold, the send without a countdown, and the local tool-name grammar, modelled on `agent/addressing.ts`.
  - `voice/utterance-context.ts` gets the target and the points.
  - The new tools go in `tools/reference.ts`.
  - Ring labels, the progress ring and the transcript chip at the hand.
  - Counters in the Detection card.
- `apps/bridge`:
  - `get_user_context` and the request context block carry the new references.
  - Markers are kept in `.hai/markers.json`.
  - `settings.ts` migrates the old defaults.
- Docs: `docs/tools.md`, `docs/gestures.md`, `docs/voice.md`, `docs/decisions.md` (the hold-time spike), `docs/PLAN.md`.
- Depends on `add-two-hand-input`, `add-studio-ui`, `add-precision-aids-and-3dm-import` and `add-fist-drag-pan`. Archive them first, since this change modifies requirements they introduce or change. `add-agent-turn-review` is unaffected.
