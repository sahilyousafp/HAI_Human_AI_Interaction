# Tasks

Depends on `add-generated-panels`, `add-agent-cameras` and `add-agent-workers` being applied. No test in this change reaches a real open-data host: they use a local fake data server (a small HTTP server in the test support that the adapters are pointed at); the real sources are touched only in the manual live checks (group 8).

## 1. Information panels for every agent (ends with: Mochi opens an information panel, and a commit from it is refused)

- [x] 1.1 Add the optional `readOnly` flag to the panel document and to `panel.open` / `panel.update` in the protocol and the tool input, set by the bridge and never taken from the agent; verify with schema tests (accepts and defaults, the agent's own value is ignored)
- [x] 1.2 Give every agent the panel group in `allowedHaiTools` (lead included; helpers and the Generated panels switch keep their rules) and mark panels from agents that do not write as read-only in the tool server; verify in `roster.test.ts` (Mochi, Climate and Reviewer now list the panel tools, helpers do not, the switch off removes them) and a tool-server test
- [x] 1.3 Refuse `preview` and `commit` from a read-only panel in the page's panel client (the only place they pass through), tell the script and the agent (at close), show Close instead of Done; verify with unit tests of the client, the broker and the closure note and that the model is unchanged after a refused commit
- [x] 1.4 Update the panel tool descriptions, `SPECIALIST_CLOSE` and the Mochi prompt (what an information panel is good for, Mochi may answer "show me" with a panel of its own, no more "I have no panel tool"); the instructions version changes; verify with instruction tests and `panel-hand-docs`, `panel-security-docs` tests still passing
- [x] 1.5 Add the information-only promise to `SECURITY.md` (Generated panels section) and an attempt for it in `e2e/panel-sandbox.spec.ts`; verify with the docs tests and that spec
- [x] 1.6 e2e with the fake agent (`panel.spec.ts` style): Mochi opens a status panel (Close only), Climate's panel tries to move a column and is refused, Architect's slider still previews and commits; verify in light and dark screenshots
- [x] 1.7 Update `roster.test.ts`, `helpers.test.ts`, `docs/agents.md` ("Each agent only has its own tools" and the panel paragraph) and `docs/agent.md` (which agents, information panels); the docs tests must pass

## 2. The site and the open-data switch (ends with: Settings shows the switch, the sources and the site, and nothing is fetched while it is off)

- [x] 2.1 Add the `site` record and its validation to the protocol, saved with the project and restored on open, plus the pure conversion between geographic coordinates and model millimetres in `@hai/scene` (north angle, anchor); verify with unit tests of the scenarios (100 m north, rotated north, invalid latitude, save and reopen)
- [x] 2.2 Add the `openData` feature (off by default) and `Settings` fields (per-source switches, acknowledgements, the user's portal hosts, Show context) to the protocol and the settings hub; verify with settings tests (defaults, persistence, a non-commercial source off until acknowledged)
- [x] 2.3 Add the Settings screen: the Open data switch with the list of sources (host, what it gives, licence), the acknowledgement, the site fields, the portal list and Show context, with the cost and privacy line; verify by e2e screenshots in light and dark and by the keyboard
- [x] 2.4 Build the guarded fetch (https only, listed hosts only, address checks and redirect checks, time and size limits, content types, identifying User-Agent, per-host rate limit) and the local fake data server for tests; verify with unit tests of each scenario (private address, redirect to another host, oversized answer, slow answer, 429 pause)
- [x] 2.5 Add the disk cache, the result envelope (source, licence, attribution, observed, fetched, age, cached, inferred) and the session record of requests with a Settings list and a clear button; verify with unit tests (repeat is local, lifetimes by kind, the record content, switching off cancels a pending request)
- [x] 2.6 Add `open_data_sources` and the registration rule (tools offered only while Open data is on) and the `site_set` tool with its approval card; verify through the MCP client that no tool is offered while off, that a proposal shows a card and is saved only after Allow, and that a denial changes nothing
- [x] 2.7 Answer "set the site first" from tools that need a place and accept explicit coordinates; verify with tests for both scenarios of the site-location requirement

## 3. The context layer (ends with: neighbouring buildings are drawn in a quiet layer the agents' cameras see and nobody can select)

- [x] 3.1 Add the context store in the bridge (items with source and date, saved beside the project, cleared on project switch, marked out of date when the site changes) and the `context.set` / `context.clear` messages using the asset store and `MeshPart`; verify with unit tests of persistence, clearing and the out-of-date mark
- [x] 3.2 Draw the layer in the web app: extruded buildings (instanced), tree markers, ground raster overlay with its legend, neutral tint, no hover, selection, picking or snapping; verify with unit tests of the pick list and an e2e that a pinch on a context building selects nothing
- [x] 3.3 Show Context switch for the user only, and the layer in agents' cameras and sun studies; verify with an e2e that an agent's picture shows the layer while the user's view hides it, and that a neighbour's shadow falls on the model in a sun-study picture
- [x] 3.4 Add the read tools (`context_list`, `context_get` with the size limit and nearest-first cut) to the agents that look; verify with tests of the summary and the cut-short scenarios
- [x] 3.5 Add `context_adopt` for writers (massing from footprint and height, owner, `hai.source` tag, claim-checked, one undo step) and refuse it for readers; verify with the three scenarios (adopt, reader refused, outside the claim)
- [x] 3.6 Measure the layer budgets (2000 prisms on screen, no gap over 50 ms in the user's frames; 500 buildings fetched and drawn under 5 s) and print them from an e2e

## 4. Urban (ends with: Urban reports the buildings, green share and metrics around the site, with sources)

- [x] 4.1 Add the CKAN, Socrata and ArcGIS Hub adapters and `open_data_search` / `open_data_get` with the shipped starter portal list; agree the starter list first (design open question); verify against the fake server for catalogue search, a 5000-row table cut to the limit, and an unlisted portal refused
- [x] 4.2 Add the Overpass buildings adapter (footprints, `height` or levels with the inferred flag, radius limit, building cap, one request at a time) and `urban_buildings` filling the layer; verify with fixture answers (heights, inferred heights, the 5 km refusal, the nearest-first cut)
- [x] 4.3 Add the vegetation adapters (WorldCover class shares and the latest cloud-free greenness index read as raster windows) and `urban_vegetation`; verify with small fixture rasters served by the fake server (class shares, NDVI, date and source in the envelope, missing data reported)
- [x] 4.4 Add `urban_metrics` (building coverage ratio, mean and maximum height, green share, tree count, with the area, sources and dates; a missing input is reported and never guessed); verify with unit tests on fixed layers
- [x] 4.5 Add Urban to the roster (read-only, own colour checked against the others in light and dark, aliases, instructions: sources, age, inferred values, Open data off, panels for tables) and a helper entry; verify in `roster.test.ts` (tools by role, cannot edit, in the default team) and `helpers.test.ts`
- [x] 4.6 Add the capability rows and the sentence about the team to `AgentsView`, and Mochi's routing line; verify with a component test and a Mochi instruction test
- [x] 4.7 e2e with the fake agent and the fake data server: "Urbanist, what is around the site?" fills the layer and returns counts and sources; Open data off gives the "switch it on" answer and no request; verify the server saw no request in the second case

## 5. Climate with live data (ends with: Climate says what the air is doing now, and how old that is)

- [x] 5.1 Add the weather adapters (MET Norway global, NWS for US sites, Open-Meteo behind its acknowledgement) and `weather_now`, `weather_forecast`; verify with fixtures (values, observation time, age, which source is chosen for a US and a non-US site, the acknowledgement)
- [x] 5.2 Add the NASA POWER adapter and `climate_normals` (monthly temperature, solar radiation, wind, the period covered); verify with a fixture and the parameter limit
- [x] 5.3 Give Climate the tools and update its instructions (source and age in every report, Open data off, what to compute without data); verify in `roster.test.ts` and an instruction test, and that Climate still cannot edit
- [x] 5.4 e2e with the fake agent and server: "Climate, what is the weather now?" returns values with the age; with Open data off it says so and no request is made

## 6. Simulation (ends with: Simulation reports the ground temperature and a sun study, and uses Ladybug when the user installed it)

- [x] 6.1 Add the Landsat surface-temperature adapter (STAC search for the latest cloud-free scene within `maxAgeDays`, keyless token, windowed read of the temperature band, conversion to degrees, statistics and the share above a threshold) and `surface_temperature` with the overlay and legend in the layer; verify with a fixture scene (statistics, date and age, sensor, resolution, no scene, surface-not-air wording in the result)
- [x] 6.2 Add `simulation_geometry` (model and optionally the context layer in metres, +Z up, with the list of what was simplified); verify with unit tests on a small model (two walls and a slab) and with the context included as shading objects
- [ ] 6.3 (static spike done, see the design; the real install waits for the user to run it) Spike with a real Ladybug Tools MCP install (user's machine, manual): list its tools, find which accept geometry and in what form, note the install time and the failure modes, and record the result in the design's open question and in `docs/decisions.md`; verify by the written result and a short transcript of tool names
- [x] 6.4 Add the curated Ladybug Tools MCP entry to the Extensions tab (licence, command, requirements, experimental warning shown before anything runs; install and removal through the existing flow); verify with a component test of the entry and an e2e with a fake stdio MCP server that the install shows the warning first and adds the server only after Confirm
- [x] 6.5 Add Simulation to the roster (read-only, own colour checked, aliases, `mcp__ladybug__*` in its tools, instructions: method, data, age, no verdicts, how to install Ladybug, fallback to sun studies) and a helper entry; verify in `roster.test.ts` and `helpers.test.ts`
- [x] 6.6 e2e with the fake agent and a scripted Ladybug call: each Ladybug call shows an approval card and asking again asks again; the ground temperature report states the date, age and "not air temperature" (what Simulation says without the server is an instruction, checked in `roster.test.ts` and in the live run of 8.2)
- [x] 6.7 Add the capability rows and Mochi's routing lines for the weather, ground temperature and simulation requests; verify with an instruction test

## 7. Docs and promises (ends with: the docs tell the truth about what leaves the machine and the docs tests pass)

- [x] 7.1 Write `docs/open-data.md` (the switch, the sources with host and licence and attribution, what a request carries, the cache, the record, the site, the context layer, what "live" means for each source, the Ladybug licence boundary); verify with a docs test that every adapter's host and licence appears in it
- [x] 7.2 Amend the privacy lines in `README.md`, `docs/desktop.md` and `SECURITY.md` ("except the open-data requests you switch on, which carry a place and never your work"), and the project context in `openspec/config.yaml` (Everything runs on localhost, with the same exception); verify by reading each file and by the existing docs tests
- [x] 7.3 Update `docs/agents.md` (the team table now seven, the tools by role, Urban, Simulation, Climate's data, information panels), `docs/agent.md` (tool rows for every new tool, in the range the docs test reads), `docs/settings.md` and `docs/tools.md`; the docs tests must pass
- [ ] 7.4 (waits until add-generated-panels is archived) If `add-generated-panels` has been archived, turn the `info-panels` requirement "Every agent can offer a panel" into a MODIFIED delta of `generated-panel` replacing "Only agents that change the model can offer panels"; verify with `openspec validate` on this change and on the main specs
- [x] 7.5 Record the decisions in `docs/decisions.md` (open data egress, the context layer, information panels, the Ladybug boundary, the sources chosen and rejected), with the measured budgets

## 8. Live checks and the demo (ends with: a filmable clip and a checklist from a real run)

- [x] 8.1 Run the real sources once by hand through the adapters (manual, `HAI_LIVE_OPEN_DATA=1`): each adapter's real answer matches its fixture's shape, the User-Agent is accepted, and the terms of each source are re-read and recorded; verify by the printed report and the notes in `docs/open-data.md`
- [x] 8.2 Run each new agent and Mochi's panel against the real Claude Code (manual, `HAI_LIVE_CLAUDE=1`): Urban around a real site, Climate's weather now, Simulation's ground temperature and a sun study (and, with no Ladybug installed, how it says to install it and its offer of a sun study), Mochi's information panel; verify by a live spec that prints what happened and the checklist in the demo file
- [x] 8.3 Write `demos/19-urban-and-simulation.md` ("The site talks back": set the site, Urban's neighbours and green share in the grey layer, Climate's weather with its age, Simulation's ground temperature and shade, Mochi's information panel that cannot change the model) with a shot list and the real-run checklist, and record the clip (45 to 60 seconds); verify against a real run with Claude Code

## Workflow follow-up

- Archive this change after `add-generated-panels`, `add-agent-cameras` and `add-agent-workers` have been archived, so that task 7.4 can be done.
- Follow-up changes (not tracked here): hourly geostationary surface temperature through the Python workbench, further building sources (Overture, 3D BAG), a Ladybug geometry export if the spike shows the server can import a file.
