# Demo 18 - "The agent checks its work"

> Draft: written before a real run with Claude Code. Do a full practice run and fix this script to match what the agent really does before recording; it chooses its own cameras and geometry, so the pictures differ each time.

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

- Did Architect place cameras or use a preset, and how many pictures did it take: ______
- Did it change anything after looking (what): ______
- Did your own camera stay yours the whole time, even in the middle of a drag: yes / no
- Did a picture ever show your selection or hover: yes / no
- Time from the model changing to the agent's first picture: ______ s
- The thumbnail on the chip matches the agent's description of what it saw: yes / no

## Check after recording

- No private project names or paths in frame.
- The thumbnail is readable at 1080p, and its caption does not clip.
- The cones read as cameras (not as stray geometry) at the zoom used.
