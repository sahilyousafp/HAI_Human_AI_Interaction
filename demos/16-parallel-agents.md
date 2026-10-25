# Demo 16 - "Three agents, one model"

> Draft: written before a real run with Claude Code. Do a full practice run and fix this script to match what the agents really do before recording; they choose their own geometry, so the look differs each time.

Target length 60-75 s, 16:9, captions burned in. You ask for a garden pavilion. Mochi splits it into three parts and hands each to a specialist; three tinted regions fill in together, one agent is refused for touching another's wall (and says so), one undo reverts one part, and the Parts list shows who holds what throughout. Show my hands is on.

## Setup (before recording)

1. `pnpm dev`; open http://127.0.0.1:5173 in Edge, light theme. Claude Code is installed and signed in (the agent panel says Ready). A fresh project, so the agents start new conversations under the current instructions.
2. Settings > Features: everything on, including **Parallel modelling**. Settings > Modelling > **Show owners** on. Show my hands on. Front light on both hands; Studio Effects off. Start the camera, hold an open palm until engaged.
3. Open the agent panel and collapse nothing: the team strip and the Parts list should be in frame.
4. Recorder at 1080p, 30 fps, capturing the browser window only.

## Shot list

| # | Time | Do | Voice-over / caption |
|---|---|---|---|
| 1 | 0-10 s | Say: "Mochi, build a garden pavilion: a hall, a pond with a bridge, and a pergola along the south side." Mochi answers in a sentence and hands out three tasks with three scopes and one brief. | "One request. Mochi splits it." |
| 2 | 10-22 s | The Parts list shows three rows (hall, pond, pergola), each in its agent's colour; the chips show "part hall", "part pond", "part pergola". Hover a row: its elements light up. | "Each agent has its own part. Nobody waits." |
| 3 | 22-42 s | Elements appear in three places at once, each tinted and outlined in its owner's colour. Orbit with both hands while they work. | "Three agents, one model, at the same time." |
| 4 | 42-52 s | Ask in chat: "Architect, move the pond's bridge." The agent is refused: its message names the other agent's claim. Show the reply. | "Touching another agent's part is refused, and says whose it is." |
| 5 | 52-62 s | When done, press undo once: only one agent's part disappears, the other two stay. | "One undo, one part." |
| 6 | 62-72 s | Pinch a tinted element: it shows the selection colour, not its owner's. Open Settings > Modelling and switch **Show owners** off: the tints go, the Parts list stays. | "Owners are a layer: show them or not." |

## Check on a real run with Claude Code (fill in before posting)

- Did Mochi split the request into scopes that do not overlap, and write a brief? yes / no (if not, what did it do: ______)
- Did the three tasks run at the same time? yes / no. Time from the request to all three running: ______ s
- Did any agent try to change something it does not hold, and what did the refusal say: ______
- Did every agent keep to the brief (the datum, the colours)? yes / no: ______
- One undo reverted exactly one part: yes / no
- A claim appeared in the panel within a blink of its task starting: yes / no

## Check after recording

- No private project names or paths in frame.
- The Parts list is readable at 1080p; each agent's colour is distinct from the others'.
