# Demo 18 - "The agent checks its work"

> Checked on a real run with Claude Code (see the checklist below). An automated recording of the flow is made by `HAI_LIVE_CLAUDE=1 pnpm exec playwright test e2e/agent-eyes-demo.spec.ts` (1080p, typed request, no hands or voice; it lands in `test-results`). The agent chooses its own cameras and geometry, so the pictures differ each time, and it does not always find something to fix: in the checked run it set the roof's base so that the slab sat on the column tops instead of finding a missing column.

Target length 45-60 s, 16:9, captions burned in. You keep orbiting the model with both hands while Architect builds a pavilion and checks it from its own cameras. Its thumbnails appear on its chip, it finds a missing column and fixes it, and your view never moves. Show my hands is on.

## Setup (before recording)

1. `pnpm dev`; open http://127.0.0.1:5173 in Edge, light theme. Claude Code is installed and signed in (the agent panel says Ready). A fresh project, so the agents start new conversations under the current instructions.
2. Settings > Modelling > **Show cameras** on. Show my hands on. Front light on both hands; Studio Effects off. Start the camera, hold an open palm until engaged.
3. Open the agent panel with the team strip in frame.
4. Recorder at 1080p, 30 fps, capturing the browser window only.

## Shot list

| # | Time | Do | Voice-over / caption |
|---|---|---|---|
| 1 | 0-8 s | Say: "Mochi, build a small pavilion: six columns and a slab roof, on the empty ground." Mochi hands it to Architect. | "One request." |
| 2 | 8-20 s | While it builds, orbit slowly with both hands. Elements appear; your camera keeps following your hands and nothing else. | "I keep my own view." |
| 3 | 20-32 s | Small cones in Architect's colour appear around the pavilion, with lines to what they look at. Its thumbnail shows on its chip: "Architect iso-se". | "Architect looks from cameras of its own." |
| 4 | 32-44 s | Click the thumbnail: the picture opens larger. Escape. Architect's message says one column is missing in the south row and adds it. | "It found a gap by looking, and fixed it." |
| 5 | 44-55 s | Open Settings > Modelling and switch **Show cameras** off: the cones go, the thumbnail stays. Orbit once more. | "The markers are optional. My view was never touched." |

## Check on a real run with Claude Code (fill in before posting)

- Did Architect place cameras or use a preset, and how many pictures did it take: it used its own cameras unprompted, from the north, north-east, south-west and above (four pictures); the chip showed "Architect iso", then "Architect ne".
- Did it change anything after looking (what): yes, it set the roof slab's base to 3200 mm so that it sits on the column tops (a slab extrudes down from its base).
- Did your own camera stay yours the whole time, even in the middle of a drag: yes, the camera was identical before and after the run. The automated run does not drag, so check the drag by hand when recording.
- Did a picture ever show your selection or hover: no in the pictures checked (nothing was selected in the automated run); select something while it builds when recording, to be sure.
- Time from the model changing to the agent's first picture: the first thumbnail was on the chip 50 s after the request (Mochi's hand-off and the building included).
- The thumbnail on the chip matches the agent's description of what it saw: yes, the north-east picture shows the six columns and the slab roof next to the neighbouring block, as it described.

## Check after recording

- No private project names or paths in frame.
- The thumbnail is readable at 1080p, and its caption does not clip.
- The cones read as cameras (not as stray geometry) at the zoom used.
