# Voice

Speaking is the main way to ask the agent. Say what you want while you point at the model: "make this 300 thick", "add three floors to this block". Typing stays available beside the microphone.

## Asking

- **Hold a pinch on what you mean** (hold to talk): the microphone listens while you hold, about what was under your hand, and what you said is sent the moment you let go, with no countdown. See [gestures.md](gestures.md#hold-to-talk).
- **Press the microphone button** in the agent panel, or **hold the `` ` `` key** (the key left of 1; releasing it ends what you are saying). **Ask agent** (its A key) starts listening too.
- Speak. The microphone indicator in the header shows **Mic on** while the microphone is live, and the bar above the input shows a level meter while you speak.
- Start with a name to choose who does it: "Architect, add a stair core here". The name is taken out and Mochi hands the request to Architect ([agents.md](agents.md)).
- Stop talking: after a short silence the request ends, the microphone stops, and the transcript appears.
- The transcript waits 5 seconds with a countdown, then goes to the agent.
  - To send it at once: nod, press **Enter**, or press **Send**.
  - To throw it away: shake your head, press **Escape**, or press **Discard**. The transcript then shows as discarded.
  - Click the transcript to correct a word. That stops the countdown; press **Enter** when it reads right.

Nod and shake here are the gestures bound to "Yes" and "No" in the Gestures settings. A transcript waiting to be sent takes them before an approval card does.

## Listen for names

**Listen for names** in the Voice settings keeps the microphone open so a request can start with just a name: "Mochi, what is everyone doing?" or "Hey Mochi, status?" It is off until you turn it on, and the header then shows **Listening for names**. Only transcripts that start with a team name go to review; everything else is dropped at once, in memory. If you say only the name ("Hey Mochi") and then pause, the microphone stays open for 5 seconds for the rest of the request, and the bar says so; the name and the request are one request. Say nothing more and the name alone goes to review. See [agents.md](agents.md#listen-for-names).

## Tool names

Say just a tool's name and that tool is picked at once, without the agent and without a countdown: "measure", "wall", "area", "undo". The bar says which tool was picked, and nothing is sent. A sentence that only starts with a tool's name ("measure the distance between these towers") is a request and goes to the agent as usual.

- Every tool has one or more spoken names; the first is the word under its icon in the tool rings, so the rings show what to say. The full list is in [tools.md](tools.md#tools).
- Case, punctuation and the words "use", "the" and "tool" around the name do not matter: "Use the wall tool" picks Wall.
- A name of five letters or more may be one letter off ("measur" is Measure); shorter names must be exact.
- Some names include how the on-device speech model hears them, measured: "undue" picks Undo, "scatch area" picks Sketch area.

A tool from a plugin or the Rhino connector declares its own spoken names when it registers (`spoken: ["bake"]`, see [tools.md](tools.md#adding-a-tool)); without them its label is what you say. Nothing in voice input needs to change for it.

## Spoken commands

Say what to do to the selection and it is done at once, without the agent and without a countdown: "move 3 m east", "rotate 90", "copy 4 times 6 m along y", "copy and rotate 90". The bar says what was done, and nothing is sent. What a command acts on is "this": what you pointed at while you spoke, else what is selected; with neither, it says "Select something first." and changes nothing.

| Say | What happens |
|---|---|
| **move** 3 m along x, up 2000, 30 cm west | Moves by a distance in a direction. x and east are +X, y and north +Y, up and down are Z. Distances take mm, cm or m (millimetres when no unit is said). Two distances join: "move 2 m up and 3 m east" |
| **copy**, copy 6 m y, copy 4 times 6 m along y | Copies in place, once at a distance, or as a line of copies each one step further than the one before. The copies are selected afterwards |
| **rotate** 90, 45 clockwise, minus 30 | Turns about the centre of what is selected, counter-clockwise seen from above unless you say clockwise |
| **scale** 2, 0.5, 50 percent, half, double | Scales in plan and in height about the centre of what is selected, at its lowest height |
| **mirror** x, mirror y | Flips across x or y about the centre of what is selected. Imported models cannot be mirrored |
| **select** all, all walls, columns, level 2, none | Selects by type or level; "deselect" or "clear the selection" clears it |
| **delete** this, all columns | Asks first: nod or press Enter to delete, shake or Escape to keep |
| **hide**, **isolate**, **show all** | Takes elements out of the view (nothing is saved or undone) and brings them back |

Commands chain with "and", "then" or a comma, and each step acts on what the one before left: "copy 3 m x then scale 0.5" makes a copy 3 m along and halves it. A copy leaves the original alone, and what follows it acts on the copies; what comes before it changes the original. A chain is one undo step named after what was said ("Copy, rotate 90 degrees"). A transcript starting with "select" can act on what it selected: "select all walls and move 2 m up".

All or nothing: if one word of what you said is not understood, the whole transcript goes to the agent as a request, and nothing is guessed. A whole type is only deleted when you say "all" ("remove the wall" is for the agent). A tool's own name ("copy", "move", "delete") still picks that tool.

The agent has the same operations as `transform_elements` ([agent.md](agent.md)), so what you can say it can do too, on any element, and "copy this along the curve" is a request for it.

With **Claude chat** off (Settings > Features) only commands run: a transcript that is not a command shows "Not a command: ..." and is sent nowhere, the chat panel is gone, listening for names is off, and a small microphone button and bar over the model take the chat's place.

## Point and speak

Select what you mean, then speak: the current selection is what "this" and "these" refer to. While you speak, every element you tap into the selection is captured too, in order, and shows a numbered marker in the model (1, 2, ...) until the request is sent or discarded, so you see what it will mean before it goes. A hand pointer snaps to the nearest model when you pinch close to it ([gestures.md](gestures.md)), so selecting does not take a pixel-exact pinch.

To have the hand pointer pick things out for you instead, turn on **Number what I point at** in Settings > Features (it is off by default, so moving your hand across the model while talking marks nothing):

- Every element the hand pointer rests on for 300 ms or more is captured, in order, and numbered. Passing over something briefly does not count.

The agent receives the transcript with a short context block: the captured elements in order (type, id and name), the selection, and the point on the ground under your hand when you stopped speaking (millimetres). A held pinch adds what it locked ("this": an element, or a point with the drawing aid that placed it) and the points P1, P2 your hand rested on while you spoke. Every request, typed or spoken, also carries the sketches you drew (S1, S2, paths and outlines in millimetres, cleared once sent) and the project's lettered markers (A, B), so "a wall along S1" or "the entrance at marker B" need no more words. The agent can read the same with `get_user_context`. See [tools.md](tools.md#tools) for Sketch line, Sketch area and Place marker.

## Privacy

- **On this laptop is the default.** Speech is turned into text on your machine by Moonshine (base, ONNX, MIT licence) running in a Web Worker on WebAssembly. Voice activity detection is Silero VAD (via vad-web) in an AudioWorklet.
- **Audio never leaves the machine and is never stored.** The utterance is kept in memory only until its transcript exists, then dropped. Nothing goes to disk, the bridge or the network. An automated test plays a recorded phrase as the microphone and fails if any request or bridge message carries audio, and a negative control proves the check catches an injected audio upload.
- **The microphone is off until you ask.** The page requests no microphone on load. It opens when you press the button, hold the key, hold a pinch or choose Ask agent, and closes as soon as the utterance ends (for a held pinch, as soon as you let go). Only **Listen for names** keeps it open, and only while you have it on.
- **The model files are local.** `pnpm assets` downloads them once from a pinned revision, checks each against its SHA-256, and the app serves them itself. Nothing is fetched from a model hub or CDN while you use the app.
- **Cloud speech is opt-in.** The Voice settings offer the browser's own speech service instead. Your browser then sends what you say to its vendor (Google for Chrome, Microsoft for Edge) to turn it into text. The setting says so, and it is off unless you choose it.

## Timings

All values live in `apps/web/src/voice/voice-config.ts`; a unit test checks that this table matches it.

| Setting | Value | Meaning |
|---|---|---|
| `silenceMs` | 800 | Silence after speech that ends the request |
| `maxUtteranceMs` | 20000 | A request ends after this long, whatever |
| `noSpeechMs` | 8000 | Listening stops if you say nothing for this long |
| `sendDelayMs` | 5000 | The transcript is sent this long after you stop, unless you send or discard it first |
| `afterNameMs` | 5000 | After a name on its own ("Hey Mochi") the microphone stays open this long for the rest of the request |
| `dwellMs` | 300 | With Number what I point at on, the hand pointer must rest on an element this long while you speak for it to be captured |

The Voice settings show where transcription runs and the 90th percentile of the time from the end of speech to the transcript. The target is under one second; on the reference laptop a two-second phrase transcribes in about 0.2 s. The speech model (63 MB) loads while you speak the first request, in about 1.5 s.

## Mochi's voice

Mochi answers out loud, in a voice generated on this laptop (Kokoro on WebGPU, or a voice installed on the computer). Talking to Mochi interrupts it; the speaker button beside the microphone mutes it. See [agents.md](agents.md#spoken-replies).

## When the microphone does not work

| What you see | What to do |
|---|---|
| "The microphone is blocked for this page." | Allow it from the icon at the left of the address bar, then press the microphone again |
| "No microphone was found." | Connect one and try again |
| "The microphone could not start." | Close other apps that use the microphone, then try again |

Typing works whatever the microphone does.
