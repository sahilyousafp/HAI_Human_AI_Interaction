# Tasks

## 1. Listening first

- [x] 1.1 The Speaker stops when the microphone opens, drops the rest of that reply and of any stopped reply, and speaks at most three sentences of a reply. Verify: `speaker.test.ts`.
- [x] 1.2 Record where a reply was cut and read on from there on request; show the mark in the chat. Verify: `speaker.test.ts`, `e2e/hold-to-talk.spec.ts`.

## 2. Short replies

- [x] 2.1 Tighten the agent's instructions; cut long finished replies with Show more. Verify: `reply-clamp.test.ts`.

## 3. Requests in the model

- [x] 3.1 Find what a request concerns, and draw the badge and tag; answer by pinch, nod or shake. Verify: `approval-anchor.test.ts`, `e2e/approval-badge.spec.ts`.

## 4. The collapsed rail

- [x] 4.1 Add the `railStrip` setting, the strip planner and the strip. Verify: `settings.test.ts`, `rail-strip.test.ts`.
- [x] 4.2 Add Settings > Chat rail. Verify: `e2e/chat-rail-strip.spec.ts`.

## 5. Integration

- [x] 5.1 Update `docs/agent.md`, `docs/settings.md` and `docs/voice.md`; run the unit suite, Biome, tsc and the touched Playwright specs.
