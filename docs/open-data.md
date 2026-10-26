# Open data

Your agents can read open data about the place a project stands in: the weather, buildings, vegetation, the ground's temperature and the catalogues of open-data portals. It is **off by default** and it is your choice, because it is the one thing in HAI that reaches the internet for you.

## What leaves your machine

- **Nothing, until you switch it on.** Settings > Open data > **Open data** (also in Settings > Features). While it is off no agent is offered an open-data tool and the app makes no request to any open-data host.
- **A place, an area, a time or a search text, never your work.** A request carries the project's site (or coordinates the agent names), a radius, a date or a text the agent searches for. It never carries your model, element or project names, file paths, camera pictures, your voice or the conversation. Every request names the app in its User-Agent (`HAI/<version> ...`), and sends no account, key or cookie.
- **Only the hosts listed in Settings, over HTTPS.** Each source below lists the host it uses. A request to any other host is refused with the reason, an address on a private network (127.0.0.1, 10.x, 192.168.x and the like) is refused even if a portal names it, and a redirect to another host stops the request. A request ends after 10 seconds, and an answer larger than its limit (2 MB of text, 20 MB of raster) is cut off.
- **You can see it.** Settings > Open data > Requests lists each request of this session: the time, the host, what it was for, whether it came from the saved answers and how large it was, or why it failed. **Clear the list** empties it; the saved answers stay.
- **Switching it off is immediate.** A request in flight ends, and the agents are restarted so the tools go.

## The sources

Each source has its own switch, on once Open data is on, except one whose free service is for non-commercial use (Open-Meteo), which stays off until you press **I understand**.

| Source | Host | Provides | Licence |
|---|---|---|---|
| MET Norway | `api.met.no` | Weather now and the forecast, worldwide | CC BY 4.0 and NLOD |
| US National Weather Service | `api.weather.gov` | Weather now and the forecast, United States | US government data, public domain |
| Open-Meteo | `api.open-meteo.com` | Weather now and the forecast, worldwide | CC BY 4.0 (data); the free service is for non-commercial use |
| NASA POWER | `power.larc.nasa.gov` | Climate normals and solar radiation, worldwide | NASA open data |
| OpenStreetMap (Overpass) | `overpass-api.de` | Buildings with heights, and trees | ODbL 1.0 |
| ESA WorldCover | `esa-worldcover.s3.eu-central-1.amazonaws.com` | Land cover at 10 m (tree, shrub and grass cover) | CC BY 4.0 |
| Sentinel-2 (Earth Search) | `earth-search.aws.element84.com`, `sentinel-cogs.s3.us-west-2.amazonaws.com` | Greenness (NDVI) from the latest cloud-free scene | Copernicus Sentinel data, open |
| Landsat (Planetary Computer) | `planetarycomputer.microsoft.com`, `landsateuwest.blob.core.windows.net` | Ground temperature from the latest cloud-free scene | US government data, public domain |
| Open-data portals | the starter list and the hosts you add | Datasets of CKAN, Socrata and ArcGIS Hub catalogues | Each dataset's own licence |

No source needs an account, a key or a sign-in, and the app never asks for one. The hosts and licences are those of the adapters as they are added, and the terms of each are re-read when its adapter is written.

Every result carries its **source, licence, attribution, the time it was observed, the time it was fetched and its age in minutes**, and a value that was worked out rather than read (a building's height from its number of levels) is marked as inferred. Agents are told to repeat the source and the age when they report. "Live" differs by source: weather is minutes old, a satellite scene is days old.

## Saved answers

Answers are kept in `.hai/open-data` in the workspace (not in the project) for a time that depends on the kind of data, so a repeated question is answered at once from disk. A cached answer keeps the time it was first fetched, so the age an agent reports is honest. A host that answers "slow down" (HTTP 429 or 503) is left alone for the time it asks, and requests to one host go one at a time, a quarter of a second apart.

## The portals

Agents may search the catalogues of the hosts in Settings > Open data > Portals: a starter list of large public catalogues (`catalog.data.gov`, `data.gov.uk`, `opendata.swiss`, the open-data portals of New York (`data.cityofnewyork.us`), San Francisco (`data.sfgov.org`), Chicago (`data.cityofchicago.org`), Los Angeles (`data.lacity.org`) and Seattle (`data.seattle.gov`), and ArcGIS Hub (`hub.arcgis.com`)) and the hosts you add (a host name such as `data.example.org`, no `https://`, no path).

## The site

A project can have a **site**: the latitude and longitude where the model's anchor point stands, which way true north points (degrees counter-clockwise from the model's +Y axis) and the anchor point itself (millimetres, the origin by default). It is saved with the project, in `.hai/site.json`, and is what turns a place into model coordinates (north is +Y unless you turn it).

Enter it in Settings > Open data > **Site**, or let an agent propose it: when you tell Mochi where the project stands, an agent calls `site_set` and an **approval card** shows the values, with **Allow** and **Deny** and no "Always allow", every time. Nothing is saved until you allow it. A tool that needs a place and finds no site says so and how to set it, and makes no request; an agent may also name coordinates of its own to ask about another place, which never changes the site.

## What the agents have

`open_data_sources` tells an agent which sources it may use now and the project's site; `site_set` proposes the site. They are offered only while Open data is on, to Mochi, Climate, Urban and Simulation. The rest are given by role, and never change the model:

| Agent | Open-data tools | What they answer |
|---|---|---|
| Urban | `open_data_search`, `open_data_get`, `urban_buildings`, `urban_vegetation`, `urban_metrics` | Datasets of the portals, the neighbouring buildings and trees, the green cover and greenness, and the coverage, height and green share of the site |
| Climate | `weather_now`, `weather_forecast`, `climate_normals` | The weather now and for the next days, and the climate of the month, each with its source and age |
| Simulation | `surface_temperature`, `simulation_geometry`, and the weather tools | The ground's temperature from the newest clear satellite scene, and the model as a simplified description to build a simulation from |

See [agent.md](agent.md) and [agents.md](agents.md).

## Ground temperature is surface temperature

`surface_temperature` reads Landsat's thermal band: the temperature of the ground and roofs seen from above (not the air), at 30 m, at the moment a satellite passed, which is days to weeks ago. The result and the legend say the date and the age, and an agent is told to say both. If no scene with little cloud exists within the age limit, the agent is told when the last scene was and receives no values. Only the site's coordinates and a radius are sent.

## Ladybug Tools

Daylight and energy simulation come from the **Ladybug Tools MCP server**, a community project under the **GPL-3.0** licence, which you install yourself. It is a **separate program**: HAI does not include, download, start or link it. In the agent panel's Extensions tab a card shows its licence, the install command (run by you, in a terminal), what it needs and that it is experimental. Its button only fills in the add-server form; nothing is added until you press **Add server**. HAI then talks to it over MCP like to any other extension, and every one of its calls asks for your approval. Without it, Simulation says so, says how to install it and offers what it can do without it: sun studies, the shade of the neighbours, the ground's temperature and the weather.

## The context layer

What agents fetch about the place (neighbouring buildings, trees, ground data such as vegetation cover or the ground's temperature) is drawn in the viewer as a **context layer**, beside the model and not part of it.

- **Read-only.** Nothing in it is picked, snapped to or selected: a pinch on a neighbour that stands in front of your model selects your model. It has no undo step, no claims and is never saved in the model; it is kept in the project's `.hai/context.json` and returns when the project is opened.
- **Quiet.** Buildings are extruded footprints in a cool grey (lighter or darker with the theme), clearly unlike the warm greys of your own elements; trees are small cones; ground data is a coloured overlay on the ground with a **legend** (what it is, the unit, the source, the date and a colour scale) and the **credits** the data asks for. A building whose height was worked out rather than read is marked as such to the agents.
- **Shadows are real.** The neighbours cast shadows, so a sun study shows the shade they put on your model. The shadow map widens to take in what is around.
- **Show context** (Settings > Open data) hides the layer from your view. Agents' own pictures and sun studies still include it.
- **Out of date.** If the site changes after the layer was fetched, the legend says so; it is rebuilt only when an agent fetches it again.
- **Up to 3000 buildings, 5000 trees and 4 ground overlays**; past that the nearest to the site are kept.

Agents read it with `context_list` (what it holds, the sources and dates, whether it is current) and `context_get` (the items near a point, nearest first, at most 200 at a time, in model millimetres). An agent that changes the model can **adopt** chosen buildings with `context_adopt`: each becomes an ordinary element (its footprint extruded to its height, as a slab), inside the agent's claim, as one undo step, tagged `context.source` and `context.id`. The layer keeps its own copy. Agents that only read cannot adopt.
