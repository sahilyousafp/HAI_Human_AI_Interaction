# Demo 19 - "The site talks back"

> Checked on a real run with Claude Code and the real open-data servers (see the checklist below). An automated recording of the flow is made by `HAI_LIVE_CLAUDE=1 pnpm exec playwright test e2e/urban-simulation-demo.spec.ts` (1080p, typed requests, no hands or voice; it lands in `test-results`, with a report). It takes several minutes because the real servers and the real model do, so the clip is cut down to the moments in the shot list.

Target length 45-60 s, 16:9, captions burned in. You tell Mochi where the project stands and allow it on a card. Urban fetches the neighbouring buildings and trees, which appear in a quiet grey beside your model with a legend and credits. Climate reads the weather and says where it came from and how old it is. Simulation reads the temperature of the ground around the site, says it is the surface and not the air, and says how many days ago it was measured. Mochi puts what was found on a panel that only shows: it has Close and no Done, and nothing in the model moves.

## Setup (before recording)

1. `pnpm dev`; open http://127.0.0.1:5173 in Edge, light theme. Claude Code is installed and signed in (the agent panel says Ready). A fresh project, so the agents start new conversations under the current instructions. You are online.
2. Settings > **Open data** on (it is off by default). Leave the site empty: Mochi gets it from you. Settings > Open data > **Show context** on.
3. Show my hands on. Front light on both hands; Studio Effects off. Start the camera, hold an open palm until engaged.
4. Open the agent panel with the team strip in frame.
5. Recorder at 1080p, 30 fps, capturing the browser window only.

## Shot list

| # | Time | Do | Voice-over / caption |
|---|---|---|---|
| 1 | 0-8 s | Say: "Mochi, the project stands in central Amsterdam, at latitude 52.3731 and longitude 4.8922. Save that as the site." A card shows the place and has no "Always allow". Press Allow. | "I tell it where the project stands, and I decide." |
| 2 | 8-22 s | Say: "Urban, fetch the buildings and trees within 150 m of the site and the green cover there." Grey buildings and small trees appear around your model; the legend and the credits show. Pinch a neighbour in front of your model: your model is selected, not the neighbour. | "Urban reads the neighbours. They sit beside the model, never in it." |
| 3 | 22-32 s | Say: "Climate, what is the weather at the site right now?" Its answer names MET Norway and says how many minutes old it is. | "Climate says where it came from, and how old it is." |
| 4 | 32-46 s | Say: "Simulation, how warm is the ground around the site?" A red-to-blue overlay lands on the ground with its legend: "Surface temperature (not air)", the scene's date. | "Simulation says this is the surface, and how long ago it was measured." |
| 5 | 46-58 s | Say: "Mochi, put a short summary of what we found on a panel." Nod to open it. The panel has Close and no Done. | "Mochi's panel only shows. It cannot change the model." |

## Check on a real run with Claude Code (fill in before posting)

- Did the site card show the values with no "Always allow", and was nothing saved until Allow: the card is raised by the site tool for any agent and is allowed by the automated run, which then had the site 52.3731, 4.8922, north 0 (saved in `.hai/site.json`); check the card by eye when recording.
- Did Urban's neighbours appear in grey beside the model, with a legend and credits: yes, 190 buildings and 35 trees within 150 m (227 items in the layer with the greenness overlay); 158 heights measured, 10 inferred from levels, 22 the 9 m default; coverage 44.3 %, mean height 16 m, tallest 38.9 m. It also said what OpenStreetMap relations might be missing. The legend names the greenness layer with its source and date (Sentinel-2, 2026-09-25) and the credits name OpenStreetMap, Copernicus Sentinel and Landsat.
- Did Urban report where its numbers came from: yes, OpenStreetMap through Overpass (ODbL 1.0), fetched today, with its age. The green share was 0 % on the land-cover map and it said the satellite greenness reading disagreed, instead of choosing one.
- How long did the neighbours take: 78 s for the request (the public Overpass server answers a dense district in 24 to 36 s on its own); a repeat is answered from the saved answers at once. Cut or speed this step in the clip and say so.
- Did Climate say its source and age: yes, MET Norway (CC BY 4.0 and NLOD), 12.2 °C, cloudy, wind 5.5 m/s from 238 degrees, and the reading was 20 minutes old when fetched. 25 s.
- Did Simulation say it is surface and not air temperature, and the scene's date and age: yes, 16.1 to 18.9 °C (mean 17.9 °C) from Landsat 9, 12 October 2026, 14 days old, 2 % cloud. The overlay and its legend ("Surface temperature (not air)") are on the ground. 191 s for this step, because it also ran two sun studies (clock noon and solar noon) and checked neighbours at a wider radius: it found no shade from the neighbours at noon on 21 June and said that 22 of the 190 neighbours use the 9 m default height, so the result depends on those guesses. Its report was cut off by the task summary limit, and Mochi said so and asked for the rest.
- Did Mochi's panel open after a nod, and was it information only: yes, "Site summary - central Amsterdam", named for Mochi, with the three tables (buildings and trees, weather, ground) and Close only (no Done); the model was unchanged. The agent sized the panel so that its last source line is cut off at the bottom (it scrolls): ask for a taller one when recording.
- Which hosts were contacted: api.met.no, earth-search.aws.element84.com, esa-worldcover.s3.eu-central-1.amazonaws.com, landsateuwest.blob.core.windows.net, overpass-api.de, planetarycomputer.microsoft.com and sentinel-cogs.s3.us-west-2.amazonaws.com: every one is in Settings > Open data.
- The whole automated run took 348 s (the raw clip is 357 s, 1080p; `.hai/demos/19-urban-and-simulation.mp4`, not in git); the clip is cut to the shot list.

## Check after recording

- No private project names or paths in frame; the site is a public place.
- The legend and credits are readable at 1080p, and the colour scale is not clipped.
- The neighbours read as context (quiet grey), not as part of the model, in the light and the dark theme.
- Settings > Open data > Requests shows only the hosts you expect (no host that is not in the list).
- The cut keeps the real waiting times honest: say "sped up" in the caption where a step is shortened.
