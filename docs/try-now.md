# Try now

The site's **Try now** button (hai.spairl.si, the hero) opens `/try/`: the HAI viewer running on its own in the visitor's tab, with nothing to install and nothing sent anywhere.

## What a visitor can do

- Explore a sample building: orbit, pan and zoom with the mouse, the view cube for named views, select, move, copy and the other tools.
- **Import** their own Rhino `.3dm` (read in the tab), see it, undo it, **Clear** the model, and **Save as 3dm** to take the result away.
- Turn the camera on and use their **hands** (the tracking models run in the tab; the video never leaves it).
- Type commands with no agent: "select all walls and move 2 m up", "array 5 times", "make it 4 m" ([voice.md](voice.md#spoken-commands) lists them).

## What is not there

No agent (Claude chat is off), no voice (the speech models are about 500 MB and are not shipped), no Rhino connection, no projects on disk, no Python or geometry kernel. Nothing is saved: a reload starts again from the sample. The desktop app has all of those.

## How it is built

The same app (`apps/web`) built in `try` mode: `vite build --mode try` (`pnpm --filter @hai/web build:try`). It differs in three small ways:

- `apps/web/src/local/local-bridge.ts` stands in for the bridge. It answers the scene messages the app already speaks (apply, undo, redo, selection, resync) with the same `SceneStore` the bridge uses (`packages/scene/src/store.ts`), keeps imported geometry in memory, and sends settings with the agent, voice, open data, generated panels and parallel modelling off. The rest of the app does not know it is not talking to a bridge.
- `base` is `/try/`, and the files the app gives workers a full address for (tracking models, Rhino import) go through `siteUrl()` (`apps/web/src/site-url.ts`), which follows it.
- Only what the trial needs is copied from `public/` (about 55 MB: MediaPipe, rhino3dm, the two tracking models). `pnpm assets --shipped-only` is enough to build it.

`website/scripts/copy-try.mjs` (`npm run build:try` in `website/`) builds it and copies it to `website/public/try`, git-ignored like `public/media`, because Slate builds only the `website/` folder. See `website/README.md`, "Try now".

## Tests

`pnpm test:e2e:try` (`playwright.try.config.ts`, `e2e-try/`) builds the trial, serves it and checks: the sample shows and runs in the tab, an import of a real `.3dm` works and saves back as one, Clear and Undo, a typed command, and that no WebSocket, bridge or speech-model request is made. It runs in CI after the main end-to-end tests. `apps/web/src/local/local-bridge.test.ts` holds the in-page hub to the bridge's message behaviour.

## Later

Voice as an opt-in "Turn on voice" button that downloads the small WebAssembly model (170 MB), and WebGPU only where it measures faster ([decision/onnx.html](decision/onnx.html)); saving a project in the browser (IndexedDB or a file the visitor picks) instead of only as a `.3dm`.
