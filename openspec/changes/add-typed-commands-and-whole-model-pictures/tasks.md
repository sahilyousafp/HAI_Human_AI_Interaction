# Tasks

## 1. Typed commands

- [x] 1.1 A text box in the command bar that gives its text to the voice input as a transcript; the bar shows with chat off whatever the voice feature. Verify: `e2e/spoken-commands.spec.ts`.

## 2. Hidden elements in the agents' pictures

- [x] 2.1 Keep hidden elements in the scene, invisible and not pickable, and show them while an agent's picture is drawn. Verify: `agent-shot.test.ts`, `e2e/spoken-commands.spec.ts`.

## 3. Integration

- [x] 3.1 Update `docs/voice.md` and `docs/settings.md`; run the unit suite, Biome, tsc and the touched Playwright specs; run the real agent once for the array (`e2e/geometry-live.spec.ts`).
