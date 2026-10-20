# Voice

Speaking is the main way to ask the agent. Say what you want while you point at the model: "make this 300 thick", "add three floors to this block". Typing stays available beside the microphone.

## Asking

- **Press the microphone button** in the agent panel, or **hold the `` ` `` key** (the key left of 1; releasing it ends what you are saying). **Ask agent** in the tool palette starts listening too.
- Speak. The microphone indicator in the header shows **Mic on** while the microphone is live, and the bar above the input shows a level meter while you speak.
- Stop talking: after a short silence the request ends, the microphone stops, and the transcript appears.
- The transcript waits 1.5 seconds with a countdown, then goes to the agent.
  - To send it at once: nod, press **Enter**, or press **Send**.
  - To throw it away: shake your head, press **Escape**, or press **Discard**. The transcript then shows as discarded.
  - Click the transcript to correct a word. That stops the countdown; press **Enter** when it reads right.

Nod and shake here are the gestures bound to "Yes" and "No" in the Gestures settings. A transcript waiting to be sent takes them before an approval card does.

## Point and speak

While you speak, the app records what your hand points at:

- Every element the hand pointer rests on for 300 ms or more is captured, in order. Passing over something briefly does not count.
- Every element you tap into the selection while speaking is captured too.
- Each captured element shows a numbered marker in the model (1, 2, ...) until the request is sent or discarded, so you see what "this" and "these" will mean before it goes.
- If you did not point at anything, the current selection is what you meant: select first, then speak.

The agent receives the transcript with a short context block: the captured elements in order (type, id and name), the selection, and the point on the ground under your hand when you stopped speaking (millimetres). It can still read the full context with `get_user_context`.

## Privacy

- **On this laptop is the default.** Speech is turned into text on your machine by Moonshine (base, ONNX, MIT licence) running in a Web Worker on WebAssembly. Voice activity detection is Silero VAD (via vad-web) in an AudioWorklet.
- **Audio never leaves the machine and is never stored.** The utterance is kept in memory only until its transcript exists, then dropped. Nothing goes to disk, the bridge or the network. An automated test plays a recorded phrase as the microphone and fails if any request or bridge message carries audio, and a negative control proves the check catches an injected audio upload.
- **The microphone is off until you ask.** The page requests no microphone on load. It opens when you press the button, hold the key or choose Ask agent, and closes as soon as the utterance ends.
- **The model files are local.** `pnpm assets` downloads them once from a pinned revision, checks each against its SHA-256, and the app serves them itself. Nothing is fetched from a model hub or CDN while you use the app.
- **Cloud speech is opt-in.** The Voice settings offer the browser's own speech service instead. Your browser then sends what you say to its vendor (Google for Chrome, Microsoft for Edge) to turn it into text. The setting says so, and it is off unless you choose it.

## Timings

All values live in `apps/web/src/voice/voice-config.ts`; a unit test checks that this table matches it.

| Setting | Value | Meaning |
|---|---|---|
| `silenceMs` | 800 | Silence after speech that ends the request |
| `maxUtteranceMs` | 20000 | A request ends after this long, whatever |
| `noSpeechMs` | 8000 | Listening stops if you say nothing for this long |
| `sendDelayMs` | 1500 | The transcript is sent this long after you stop, unless you send or discard it first |
| `dwellMs` | 300 | The hand pointer must rest on an element this long while you speak for it to be captured |

The Voice settings show where transcription runs and the 90th percentile of the time from the end of speech to the transcript. The target is under one second; on the reference laptop a two-second phrase transcribes in about 0.2 s. The speech model (63 MB) loads while you speak the first request, in about 1.5 s.

## When the microphone does not work

| What you see | What to do |
|---|---|
| "The microphone is blocked for this page." | Allow it from the icon at the left of the address bar, then press the microphone again |
| "No microphone was found." | Connect one and try again |
| "The microphone could not start." | Close other apps that use the microphone, then try again |

Typing works whatever the microphone does.
