# Design

## Context

Builds on the palette's Ask agent slot (`add-gesture-tool-palette`), pointer and picking (`add-gesture-viewport-navigation`), nod and shake (`add-gesture-recognition`) and the agent request path (`add-claude-agent-bridge`). Checked: `@huggingface/transformers` 4.3.x is Apache-2.0 and `onnx-community/moonshine-base-ONNX` is MIT on Hugging Face.

## Goals / Non-Goals

**Goals:**
- From end of speech to transcript on screen in under 1 s on the reference laptop.
- "This" resolves to the right element without the user having to select first.

**Non-Goals:**
- Word-level alignment between words and pointing (the order of pointing is enough for v0.1).
- Streaming partial transcripts while speaking (the transcript appears when the utterance ends; a live level meter shows that audio is heard).

## Decisions

**Voice activity detection: Silero VAD via `@ricky0123/vad-web`** in an AudioWorklet. It gives speech start and end events, with the end at 800 ms of silence, and buffers only the current utterance in memory. Rejected: fixed push-to-talk only (hands are busy pointing; a key hold is kept as an alternative).

**Transcription: Moonshine base (ONNX, int8) with transformers.js** in a dedicated Web Worker, on WebAssembly. Measured during implementation: about 0.2 s per two-second phrase on WASM against about 2 s on WebGPU with the same int8 files, so WebGPU is not used (see `docs/decisions.md`). Model files are fetched once by the asset script with SHA-256 checks and served from `apps/web/public/models`, never from a runtime CDN. Rejected: whisper.cpp sidecar (needs a native binary per platform); Web Speech as default (sends audio to a cloud service).

**Audio lifetime.** PCM buffers live only in the worker, are transferred (not copied) from the worklet, and are released after transcription. Nothing goes to IndexedDB, files or the bridge. The tracking-frame rule ("no pixels on the wire") gets a sibling test for audio.

**Utterance context recorder.** Subscribes to pointer-hover changes, taps and selection, with capture timestamps. A dwell filter keeps hovers of 300 ms or more. Markers render as numbered billboards in the viewer. On send, context is `{ references: [{id, type, name}], selection: id[], groundPoint: [x,y,z] mm }`.

**Delivery to the agent.** The bridge prepends a compact block to the user turn, for example `[context] references: 1) wall 01J... "North facade"; selection: none; ground point: 12400, 3100, 0 mm`, and the agent can still call `get_user_context` for detail. Rejected: relying only on the tool call (an extra round trip on every request, and the agent sometimes skips it).

**Send window.** A 1.5 s countdown ring around the transcript. Nod or Enter sends, shake or Escape discards. These reuse the confirmation helper from the palette's Delete tool.

**Latency budget.** End of speech to transcript at most 1 s (p90), measured from the VAD speech-end event to transcript-ready in the worker. It is shown in the HUD debug panel and recorded in the demo script.

## Risks / Trade-offs

- [Moonshine accuracy on architectural vocabulary such as "mullion" or "parapet"] → The transcript is editable before sending (click to edit). A small domain word list is kept for later fine-tuning or prompt hints.
- [Model download size of about 60 MB on first install] → One-time fetch by the asset script, cached and checksum-verified.
- [Slower CPUs transcribe more slowly on WASM] → The end-of-speech-to-transcript p90 is shown in the Voice settings; a WebGPU path with fp16 weights can be added if it is needed.
- [Pointer drift while speaking captures the wrong element] → The 300 ms dwell rule plus visible numbered markers before sending, and shake to discard.
