# Demo 06 - "First agent edit"

Week 6 clip. Target length 50-60 s, 16:9, captions burned in. The agent is your own Claude Code, running on your own plan. It models in Rhino, with a script you approve; HAI is where you see it and ask for it.

## Setup (before recording)

1. Claude Code installed and signed in (`claude` in a terminal once). At least one user-level MCP server configured in Claude Code, so the Extensions tab has something of yours to show.
2. Rhino 8 or 9 with the HAI plugin installed (`docs/hosts.md`, Rhino, Connecting). Open a model with a low block in it (a closed Brep you can show publicly, on a named layer), run `HaiConnect`, then minimise Rhino. The top bar shows the Rhino pill connected.
3. Front light on your hands, elbows on the desk. Windows Studio Effects off.
4. `pnpm dev`; open http://127.0.0.1:5173 in Edge (dark theme). The Rhino model is drawn in the viewer; the agent panel on the left says **Ready**.
5. Send one warm-up request off camera ("What is in this scene? One sentence."), so the session has started and the Extensions tab is filled. Then reload the page: the conversation is still there. Scroll the panel to the bottom.
6. Start the camera and check the Detection card: both hands found close to 100%.
7. Recorder at 1080p, 30 fps, capturing the browser window (and, for shot 6 only, Rhino's window).

## Shot list

| # | Time | Do | Voice-over / caption |
|---|---|---|---|
| 1 | 0-4 s | The Rhino model in HAI's viewer, the agent panel on the left, hands in your lap. | "My own Claude, and my Rhino model." |
| 2 | 4-9 s | Open palm: **Engaged**. Point at the low block and pinch-tap: it is selected here and in Rhino, and the selection card shows what Rhino says it is. | "Point and pinch to say which block." |
| 3 | 9-15 s | Type "Architect, add three floors of 3.5 m to this block" and press Enter. | "Then just ask." |
| 4 | 15-30 s | Mochi hands it to Architect; the tool chips appear; the approval card shows the Python script and names Rhino. Read it for a second, then nod (or press Allow). The floors appear in the viewer as Rhino builds them. | "It writes the script for Rhino. I read it, then allow it." |
| 5 | 30-35 s | Click the `host_run` chip to expand it: the script shows heights of 3500. | "Every call is visible. Millimetres, as asked." |
| 6 | 35-42 s | Bring Rhino's window up, press Ctrl+Z once: all three floors disappear together, in Rhino and in HAI's viewer. Minimise Rhino. | "And the whole script is one undo step in Rhino." |
| 7 | 42-52 s | Open the **Extensions** tab: the `hai` server (this app) and your own user-level server, both connected; your skills below. | "And it is still my Claude Code: my servers, my skills." |
| 8 | 52-58 s | Back to **Chat**. Lower your hands. | "Next: talk to it." |

## Check on the real CLI and in a real Rhino (fill in before posting)

- The three floors were added in one turn, first attempt: ___
- Heights in the `host_run` script: ______ (expected 3500 each)
- The approval card named Rhino and showed the whole script: ___
- One Undo in Rhino removed all of them: ___
- The selection card and the request showed the block's type and layer as Rhino describes it: ___
- Your user-level server shows **connected** in Extensions: ___ (name: ______)
- No approval card appeared for the read-only tools: ___

## Expected result

- The panel shows Working while the agent runs, then Ready.
- Read-only tools run without asking. A script for Rhino (`host_run`) always shows an approval card first, which you can answer with a nod or shake.
- One Undo in Rhino reverts the whole script, as described in `docs/hosts.md`. HAI's own Undo follows your edits, not the agent's runs.

## Check after recording

- The chips, the typed request, the script and the reply are readable on a phone.
- The Extensions tab shows no secret values (only header and variable names, masked).
- No account email, organisation, private model or file paths, or other windows in frame.
