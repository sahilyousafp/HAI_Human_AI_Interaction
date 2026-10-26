# Proposal

## Why

The team can model a building and, with Climate, study sun and shadow, but nobody on it knows where the building stands. A real urban question ("what does this pavilion do to the heat of the street?", "how much green is within 200 m?", "show me the neighbouring buildings and their shadows") needs the site: the surrounding buildings, the trees, the weather today and how hot the ground actually is. All of that is published as open data, and none of it reaches an agent today: the bridge makes no outbound request at all, the project has no location, and the agents can only invent the context they need.

Two more gaps sit next to it. Climate can compute a sun position but cannot say what the air is doing now. And only agents that change the model can open a panel, so Mochi, Climate and Reviewer can only talk, even when the honest answer is a small table or a chart ("here are the numbers for this block"). Panels are the app's way of showing information that is easier to see than to read.

## What Changes

- A new specialist, **Urban**, reads urban open data: portals (CKAN, Socrata, ArcGIS Hub), buildings with heights around the site, vegetation cover and a few urban metrics (building coverage, mean height, green share, tree count). It changes nothing in the model.
- **Climate** gains open real-time climate data: the weather now, the forecast and the climate normals for the site, with the source and the age of each answer.
- A new specialist, **Simulation**, runs building-performance simulations through the **Ladybug Tools MCP server** when the user has installed it (it is GPL-3.0 and stays a separate program the user installs; HAI never bundles or links it), and reads the latest open land-surface-temperature data for the site. It says how old the data is and how the result was made.
- **Open data is a switch, off by default.** HAI's own typed tools fetch from a fixed list of open, keyless sources and nothing else. A request carries a place, an area, a time or a search text, never model geometry, names or camera images. Results are cached on disk and every one carries its source, licence, attribution, time of observation and age. Settings lists the hosts and what was contacted.
- The project gets an optional **site** (latitude, longitude, true north and the model origin), set by the user or by an agent with the user's approval, so a place can be turned into model coordinates.
- Fetched city context (buildings, trees, ground rasters) is drawn as a **read-only context layer** in the viewer, outside the project document, so it is not selected, saved or undone with the model. Agents see it through their own cameras and in sun studies. A writer can **adopt** chosen items into the model.
- **Every agent can open a panel**, Mochi and the readers included. A panel opened by an agent that does not change the model is **information only**: it cannot preview or commit changes, and the bridge refuses it if it tries.
- The default team grows from five to seven.

## Capabilities

### New Capabilities
- `open-data-access`: the Open data switch, the allowed sources, what a request may carry, caching, citation of every result and the visible record of what was contacted.
- `site-location`: the project's site and how places become model coordinates.
- `urban-context-layer`: fetched buildings, trees and rasters drawn read-only in the viewer, visible to agents' cameras, and adopted into the model by writers.
- `info-panels`: panels for every agent, information only for agents that do not change the model.
- `urban-agent`: the Urban specialist, its tools and how it reports.
- `simulation-agent`: the Simulation specialist, the Ladybug Tools MCP boundary and surface-temperature data.

### Modified Capabilities
- `agent-team`: the default team is seven; Climate reads live climate data; each agent's tools by role, now including panels for all.
- `tool-approval`: open-data tools are gated by the Open data switch rather than a card per call; Ladybug MCP tools show approval cards; no tool may send model data out.

## Impact

- `apps/bridge`: new `open-data/` (adapters, fetch guard, cache, record), tools in `scene-tools` and the roster (`roster.ts`, `agent-config.ts`), the panel gate (`allowedHaiTools`, the read-only refusal), a context store, the site in the project, the curated Ladybug entry in the extensions flow.
- `packages/protocol`: the `openData` feature and settings, `site`, `readOnly` on the panel document and messages, context-layer messages, new tool groups in `HAI_TOOLS`.
- `apps/web`: `ContextLayer`, panel host (read-only mode), Settings (Open data, site, Show context), the agents form, colours for two more agents.
- Docs and promises: `docs/agents.md`, `docs/agent.md`, `docs/settings.md`, a new `docs/open-data.md`, `SECURITY.md`, README and `docs/desktop.md` (their "nothing leaves this machine" lines gain "except open-data requests you switch on"), the project context in `openspec/config.yaml`.

**Depends on** `add-generated-panels` (the panel slot, the offer and the host; its requirement "Only agents that change the model can offer panels" is superseded here, see the design), `add-agent-cameras` (agents see the context layer through their own cameras) and `add-agent-workers` (workers inherit the new tools). Apply them first.

**Out of scope:**
- Sources that need an account, a key or a payment (NASA ECOSTRESS needs an Earthdata login; Google Earth Engine and Open Buildings need an account).
- Writing to any portal, uploading anything from the project, or fetching on the user's behalf outside an agent request.
- Extracts larger than about 2 km across, and editing rasters.
- Bundling, vendoring or wrapping Ladybug Tools, EnergyPlus, Radiance or OpenStudio.
- Hourly geostationary surface temperature (GOES-R, netCDF): a follow-up through the Python workbench.
- Further building sources (Overture, 3D BAG): the adapter seam is in, the adapters are a follow-up.
- Certified compliance results: the Simulation agent reports method and age, not a verdict.

**Demo clip (45-60 s):** `demos/19-urban-and-simulation.md` - "The site talks back". The user sets the site and asks Mochi about the street: Urban draws the neighbouring buildings and the green share in a quiet grey layer; Climate says what the air is doing now and how old that is; Simulation reports the latest ground temperature and the shade the pavilion casts, using Ladybug when it is installed; Mochi opens a small panel with the numbers, which only shows and cannot change the model.
