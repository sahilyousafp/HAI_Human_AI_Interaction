# Demo 17 - "One architect, five hands"

> Draft: written before a real run with Claude Code. Do a full practice run and fix this script to match what the agents really do before recording; they choose their own parts, so the look differs each time.

Target length 45-60 s, 16:9, captions burned in. You ask for a pavilion. Mochi shows you its plan and you drop one part; Architect splits its own task into workers that appear nested under it in its colour and fill their parts at the same time; one of them asks for a panel while another keeps modelling; Stop ends all of them. Show my hands is on.

## Setup (before recording)

1. `pnpm dev`; open http://127.0.0.1:5173 in Edge, light theme. Claude Code is installed and signed in (the agent panel says Ready). A fresh project, so the agents start new conversations under the current instructions.
2. Settings > Features: everything on, including **Parallel modelling**. Settings > Modelling: **Sessions at once** 6, **Show owners** on. Show my hands on. Front light on both hands; Studio Effects off. Start the camera, hold an open palm until engaged.
3. Open the agent panel with the team strip in frame.
4. Recorder at 1080p, 30 fps, capturing the browser window only.

## Shot list

| # | Time | Do | Voice-over / caption |
|---|---|---|---|
| 1 | 0-10 s | Say: "Mochi, build a garden pavilion: a hall, a pergola and a pond, and show me the plan first." Mochi shows its plan card: three parts, each with its agent and scope. | "Mochi shows me the split before anything starts." |
| 2 | 10-18 s | Remove the pond with its x and press Confirm: "Confirm 2 of 3". | "I take out a part. Nothing starts until I confirm." |
| 3 | 18-32 s | Architect starts; workers appear nested under its chip in its colour ("Architect 2 hall", "Architect 3 pergola"), each with its state and scope; the Parts list indents their claims. | "Architect splits its own task. Each part is its own session." |
| 4 | 32-44 s | Elements appear in both places at once, tinted in Architect's colour. One worker offers a panel for a clearance while the other keeps modelling; the offer waits its turn if another panel is open. | "Two hands working at once, one asks me a question." |
| 5 | 44-52 s | Press undo once: only the last worker's part disappears. | "One undo, one part." |
| 6 | 52-60 s | Start another run and press Stop all: the specialist and its workers stop within seconds, and no claim is left. | "Stop ends all of them." |

## Check on a real run with Claude Code (fill in before posting)

- Did Architect start workers on its own, how many, and with scopes inside its own claim (sub-parts `part/name`)? yes / no: ______
- Did the workers run at the same time? yes / no. Time from the request to all workers running: ______ s
- Did a worker or the parent meet a refusal (a part it did not hold), and what did it say: ______
- Did the parent hear from each worker and report once? yes / no
- Did Mochi use the plan card when asked, and did it hand out only the kept parts? yes / no
- Cost note: how many sessions ran at the peak, and was the limit reached: ______
- One undo reverted exactly one worker's part: yes / no
- Stop all ended every session within 3 s: yes / no

## Check after recording

- No private project names or paths in frame.
- The nested rows and the plan card are readable at 1080p; each agent's colour is distinct from the others'.
