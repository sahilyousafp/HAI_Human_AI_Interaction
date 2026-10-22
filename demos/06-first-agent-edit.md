# Demo 06 - "First agent edit"

Week 6 clip. Target length 50-60 s, 16:9, captions burned in. The agent is your own Claude Code, running on your own plan.

## Setup (before recording)

1. Claude Code installed and signed in (`claude` in a terminal once). At least one user-level MCP server configured in Claude Code, so the Extensions tab has something of yours to show.
2. Front light on your hands, elbows on the desk. Windows Studio Effects off.
3. `pnpm dev`; open http://127.0.0.1:5173 in Edge (dark theme). The sample building loads; the agent panel on the left says **Ready**.
4. Send one warm-up request off camera ("What is in this scene? One sentence."), so the session has started and the Extensions tab is filled. Then reload the page: the conversation is still there. Scroll the panel to the bottom.
5. Start the camera and check the Detection card: both hands found close to 100%.
6. Recorder at 1080p, 30 fps, capturing the browser window.

## Shot list

| # | Time | Do | Voice-over / caption |
|---|---|---|---|
| 1 | 0-4 s | The building, the agent panel on the left, hands in your lap. | "My own Claude, inside the model." |
| 2 | 4-9 s | Open palm: **Engaged**. Point at the low massing block and pinch-tap: it is selected (status bar shows its name). | "Point and pinch to say which block." |
| 3 | 9-15 s | Type "add three floors of 3.5 m to this block" and press Enter. | "Then just ask." |
| 4 | 15-30 s | The reply streams; tool chips appear (`get_user_context`, `get_elements`, `create_elements`); the block grows three floors as the chips turn green. | "It reads what I pointed at, then edits the model live." |
| 5 | 30-35 s | Click a chip to expand it: the input shows heights of 3500. | "Every call is visible. Millimetres, as asked." |
| 6 | 35-42 s | Press **Undo** once: all three floors disappear together. | "And the whole turn is one undo." |
| 7 | 42-52 s | Open the **Extensions** tab: the `hai` server (this app) and your own user-level server, both connected; your skills below. | "And it is still my Claude Code: my servers, my skills." |
| 8 | 52-58 s | Back to **Chat**. Lower your hands. | "Next: talk to it." |

## Check on the real CLI (fill in before posting)

- The three floors were added in one turn, first attempt: ___
- Heights in the `create_elements` chip: ______ (expected 3500 each)
- One Undo removed all of them: ___
- Your user-level server shows **connected** in Extensions: ___ (name: ______)
- No approval card appeared for the scene tools: ___

## Expected result

- The panel shows Working while the agent runs, then Ready.
- Scene tool calls run without asking. Any other tool shows an approval card, which you can answer with a nod or shake (not part of this clip).
- One Undo reverts the whole turn, as described in `docs/agent.md`.

## Check after recording

- The chips, the typed request and the reply are readable on a phone.
- The Extensions tab shows no secret values (only header and variable names, masked).
- No account email, organisation or other windows in frame.
