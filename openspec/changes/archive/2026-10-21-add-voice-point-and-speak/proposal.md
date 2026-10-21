# Proposal

## Why

Typing breaks the hands-free flow, and "make this 300 thick" only works if the system knows what "this" is. Speaking while pointing is the most natural way to direct an agent at a model. This change adds on-device speech and binds spoken references to what the user pointed at.

## What Changes

- Voice requests: listening starts from the palette's Ask agent slot or by holding a key, and ends automatically after a short silence. Speech is transcribed on the laptop; audio is never uploaded or stored.
- A live transcript in the HUD and a short send window. The request goes to the agent 1.5 s after the user stops speaking, a nod sends it at once, and a shake or Escape cancels it.
- Point-and-speak: what the user points at, taps or selects while speaking is captured and sent with the request as explicit references. Elements pointed at during the utterance get a visible marker, so the user sees what "this" will mean before it is sent.
- An optional cloud speech mode (the browser's speech service). It is off by default and clearly labelled as sending audio to a third party.
- A microphone-on indicator and clear recovery messages for missing or blocked microphones.

Out of scope: spoken replies (text-to-speech), wake words, languages other than English for now, voice commands that bypass the agent (direct tools stay on the palette).

Demo clip (Week 7): "Point at a wall, say 'make it 300 thick'": the wall gets a marker while speaking, the transcript appears, the nod sends it, and the agent changes exactly that wall.

## Capabilities

### New Capabilities

- `voice-input`: microphone lifecycle, on-device transcription, the transcript and send window, and the opt-in cloud mode.
- `multimodal-intent`: capturing pointing, taps and selection during an utterance and delivering them to the agent as resolved references.

### Modified Capabilities

None. The agent request path from `add-claude-agent-bridge` is reused unchanged; references travel as structured context alongside the text.

## Impact

- `apps/web`: microphone capture, VAD and transcription worker, transcript UI, reference markers.
- `packages/protocol`: utterance and request-context schemas.
- `apps/bridge`: forwards request context to the agent as a structured block.
- New dependencies: `@ricky0123/vad-web` (MIT) for voice activity detection, `@huggingface/transformers` (Apache-2.0) running the Moonshine base ONNX model (MIT), served locally.
