# Tasks

## 1. Design

- [x] 1.1 Capture the panel's states (empty, a conversation with tool calls and a team update, an approval, narrow) in light and dark with the fake agent, and brief the UI designer with them and the tokens in `styles.css`. Verify: a spec with sizes per region, states and wireframes, within the existing tokens.

## 2. Build

- [x] 2.1 Render the panel in the workspace grid beside the stage (`App.tsx`), with `.viewer-left` keeping only the project bar. Verify: E2E "the rail docks beside the model".
- [x] 2.2 Resizable rail: drag, arrow keys, Home and End, double-click to reset, a press to step; remembered. Verify: E2E "Resize by dragging" and "A hand press steps the width".
- [x] 2.3 Collapsed strip: expand, status, name, the waiting count, the microphone. Verify: E2E "Collapsed, the rail is a 52 px strip", and the existing "1 to approve" check in `panel.spec.ts`.
- [x] 2.4 Two-row header, team chips in one scrolling row, a settled plan folded to one line. Verify: `agent.spec.ts`, `workers.spec.ts`, `parallel.spec.ts` unchanged and passing.
- [x] 2.5 Steps line for consecutive tool calls, open while running, waiting or failed. Verify: E2E "Several finished calls fold to one line" and "a running group stays open", and `agent.spec.ts` "failed tool call".
- [x] 2.6 The Files and runs tray and the two-row composer with the voice request in the field. Verify: `rhino.spec.ts` written files and `hold-to-talk.spec.ts` unchanged and passing.
- [x] 2.7 Narrow screens: a sheet over the bottom of the model. Verify: E2E "narrow screens".

## 3. Integration

- [x] 3.1 Refresh the visual baselines that show the panel or the model's width, reviewing every diff; run the unit suite, Biome, tsc and every touched Playwright spec one file at a time. Verify: all green.
- [x] 3.2 Update `docs/agent.md` and the week 20 demo script. Verify: the docs describe the rail, the steps line and the tray.
