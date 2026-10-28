# The agent team

HAI gives you a small design team made of your own Claude. **Mochi** leads it: every request goes to Mochi, which answers questions itself and hands design work to **specialists**. Each specialist works on its own task while Mochi stays free, so you can ask Mochi what everyone is doing at any time. Mochi tells you when the work is done, and says it out loud.

## The team

| Agent | What it does | Changes the model |
|---|---|---|
| **Mochi** | Takes every request, hands work to the specialists, reports what everyone is doing. Runs on Claude Sonnet. | No |
| **Architect** | Massing, levels, walls, slabs, columns, cores and stairs | Yes |
| **Product** | Furniture, fixtures and components at product scale | Yes |
| **Climate** | Sun path, shadows, orientation and daylight (sun studies), and with Open data on the weather now, the forecast and the climate normals of the site | No |
| **Urban** | The place around the project: the neighbouring buildings and trees, green cover, urban metrics and the datasets of open-data portals (needs Open data on) | No |
| **Simulation** | Performance: the ground's surface temperature from open satellite data, sun and shade, and daylight and energy studies when you have installed Ladybug Tools MCP. Reports method, data and age, never a verdict | No |
| **Reviewer** | Checks the model against the brief and common rules, and reports issues. Never edits. | No |

The team is written into the project the first time you send a request: one Claude Code agent file per agent in `.claude/agents/`. HAI never overwrites a file you have changed. Because they are Claude Code's own agent files, the same agents also work when you run `claude --agent architect` in a terminal.

## How it works

- **Each agent is its own Claude Code session.** The bridge starts `claude -p --agent <name>` for each agent when it first has work, in the project folder, with your own Claude Code setup (see [agent.md](agent.md) for the exact command). Each keeps its own conversation (`.hai/agent/<name>/session.json`), so Architect remembers its earlier tasks, and each resumes after a crash, an idle close or a restart.
- **Mochi hands out tasks.** It calls `delegate` with a specialist's name, a short title and a complete instruction. That returns at once, so Mochi's turn ends and Mochi is free for your next question while the specialist works.
- **Each agent only has its own tools.** Every session gets its own random token for the app's tool server. From the token the bridge knows which agent is calling and offers it only the `hai` tools its definition lists. Reviewer has no tool that changes the model at all, and an agent marked as not changing the model never gets those tools, whatever its file lists. Every agent that does change the model also gets `spawn_worker` (see [Workers](#workers)), `python_run` and `rhino_run_python` whatever its file lists, and every agent gets `set_view`, its four camera tools and the four panel tools (`offer_panel`, `open_panel`, `update_panel`, `close_panel`), so older projects get them too; the panel of an agent that does not change the model is information only. This holds for what the model can see as well as what the bridge allows: HAI starts each agent with its definition as the app wants it (`--agents`, see [agent.md](agent.md)), taking the app's tools from the agent's role and everything else (prompt, model, your own tools such as `Read`) from the file, because Claude Code hides any tool the file's `tools:` line does not list. Mochi can show information in a panel of its own, and hands a panel for tuning values to Architect or Product, which offers it ([agent.md](agent.md#generated-panels)). Changing an agent's tools starts it in a new conversation, since an agent resuming an old one keeps to what it said it could not do.
- **Mochi reports.** When every task Mochi handed out in one turn has finished, the bridge sends Mochi a short report (each task's agent, outcome and the specialist's summary) and Mochi tells you what was done. A report waits while you are talking to Mochi.

The first time you used HAI in a project before the team existed, that one conversation becomes Mochi's, so nothing is lost.

## Asking the team

- **Just ask.** "Add a stair core here", "how many floors does the tower have?" Mochi decides who does what.
- **Name a specialist** to choose who does it: "Architect, add a stair core here." The name is taken out of the request and Mochi hands the rest to Architect. Typed requests work the same way, and `@architect` anywhere in a typed request does too.
- **Ask Mochi to delegate**: "Mochi, ask Climate to run a winter shadow study."
- **Ask for status** whenever you like: "Mochi, what is everyone doing?" Mochi answers from the live task board (each agent's task, its latest activity and anything queued) while the specialists keep working.

Names are matched forgivingly, because speech recognition mishears them. The first one or two words are compared with each agent's name and its other names, ignoring case and punctuation and allowing one letter of difference. A greeting before the name is fine: "Hey Mochi", "Hi Architect", "OK Climate" (hey, hi, hello, ok or okay); it is taken out with the name. The defaults include the mishearings measured on the reference laptop ("Machi" and "Maci" for Mochi, "Review or" for Reviewer). Add your own under the agent in the **Agents** tab.

### Listen for names

**Listen for names** in the Voice settings keeps the microphone open, so you can start a request just by saying a name: "Mochi, what is everyone doing?"

- It is **off** until you turn it on.
- While it is on, the header shows **Listening for names** in a dashed amber pill, distinct from **Mic on** and **Mic off**.
- Everything you say is turned into text on this laptop, as for any voice request. A transcript that does not start with a team name is dropped at once, in memory: it is never shown, sent or kept.
- A transcript that does start with a name goes to the usual review: it waits 1.5 s with a countdown, a nod or **Enter** sends it, a shake or **Escape** discards it.
- While Mochi is speaking, what the microphone hears is ignored, so Mochi's own words never become a request.
- The microphone button and the talk key still work; listening for names resumes after that request.

## Scheduling

| Limit | Value | Meaning |
|---|---|---|
| `maxRunning` | 3 | Specialists working at the same time; later tasks queue. Mochi is always available on top |
| `maxSessions` | 6 | Agent sessions working at once: Mochi, every running specialist and every worker. The user's setting (Settings > Modelling > Agents working together); a worker over the limit waits for a free session |
| `workerStopMs` | 3000 | How long a stopped task's workers have to end before they are ended for it |
| `finishedKept` | 30 | Finished tasks kept on the board and in status answers |
| `summaryChars` | 600 | A specialist's final reply is shortened to this for the board, status and Mochi's report |
| `activityThrottleMs` | 250 | Streaming text updates the board at most this often |

These values live in `apps/bridge/src/agent/team.ts`; a unit test checks that this table matches it.

- **One task per agent at a time.** A second task for a busy agent waits for the first.
- **Writers with separate scopes work at the same time.** While Parallel modelling is on (the default), tasks that change the model run together when their scopes do not overlap; a task whose scope overlaps a running task's, or that has no scope (it claims the whole model), waits and says whose claim it waits for. With the feature off, one agent changes the model at a time. Agents that only read (Reviewer, Climate) work alongside either way. See [parallel.md](parallel.md): scopes, the shared brief, what a refusal says, owners and tags, scripts.
- **One undo per specialist task.** Everything a specialist changes in one task is a single undo step, labelled with the agent and the task, for example "Architect: Stair core", also when other tasks run at the same time: undoing one leaves the others' elements as they are.

## Stopping

- **One task:** open it from the team strip or its hand-off chip and press **Stop**, or ask "Mochi, stop Architect". A queued task is taken off the queue.
- **Everything:** press **Stop all** in the team strip or the stop button, or clench both hands into fists and then open them toward the camera. Mochi's turn and every task stop, and no report follows.
- A stopped task ends within 3 seconds and keeps what it already changed, as one undo step.

## The agent panel

- **The header** names Mochi and shows its state.
- **The team strip** lists the specialists. While everyone is idle it is one compact row; with work under way each specialist shows as a chip with its task: working, queued or needs approval. Press a chip to open that task.
- **Hand-off chips** in Mochi's replies show each task Mochi handed out, with its live status. Press one to open the specialist's conversation for that task: its instruction, its tool calls and its reply. The back arrow returns to Mochi.
- **Approval cards** name the agent asking. A specialist's card also waits under its hand-off chip in Mochi's chat, so you never have to go looking for it. Nod and shake work as usual.
- **Tool chips** name the agent that made the call.

### The Agents tab

The **Agents** tab lists the team from the project's files, with each agent's model, what it does and whether it changes the model. **Edit** opens an agent's definition; **Add an agent** creates one.

| Field | Where it goes |
|---|---|
| Name | The file name and Claude Code's `name` (lower-case letters, digits and -) |
| What it does | Claude Code's `description`; Mochi reads it to choose the agent |
| Model | Claude Code's `model` (`sonnet`, `opus`, `haiku`, or the same as Claude Code) |
| What it may do | Its `hai` tools: read the model, change the model, sun studies, read the city context, open data, urban open data, weather and climate data, simulation inputs (what fetches open data only while Open data is on) |
| Other Claude Code tools | Any other tools it may use, for example `Read` or `WebSearch` |
| Instructions | The file's body |
| Other names it is heard as, colour | `.hai/agents.json` |

A change applies from that agent's next task: its session restarts with the new definition and resumes its conversation. A new agent is in Mochi's team list from Mochi's next request. You can also edit the files directly; HAI reads them again before every request and task.

## Workers

A specialist that changes the model can split its **own** task into parts that are made at the same time. Asked for a pavilion, Architect starts a worker for the dome and one for the minarets (`spawn_worker`: a title, an instruction and a scope) and does the rest itself.

- **A worker is another session of the same agent**, started by the app under its own name (`architect.2`, `architect.3`, shown as "Architect 2"), with its own token and its own conversation. It gets the instruction it was given, the shared brief and its scope, and the tools of its specialist without `spawn_worker` and `delegate`: workers cannot start workers or hand tasks to other agents.
- **Its scope is cut from its specialist's claim.** It must lie inside what the specialist holds and must not overlap another worker's. When the specialist holds a part, a worker's part is a sub-part, written `<part>/<name>` (`pavilion/dome`); a part outside the claim, or a name that is not a sub-part, is refused and says how to write one. While a worker runs, its specialist cannot change that part (the refusal names the worker), and the part returns to the specialist when the worker ends.
- **Each worker is its own undo step**, labelled "Architect 2: Dome", and what it creates is owned by `architect.2` and shows in its specialist's colour.
- **The specialist's task ends after its workers.** It is told how each ended, with its summary, as a short turn of its own, so it can fix a part or report. Stopping the task, a failure or a crash stops its workers, and every claim is released within 3 seconds; Stop all and a project switch do the same, and a worker waiting for a free session is taken off the queue.
- **Cost.** Every worker is a model session of your own Claude Code, with its own cost: a run with workers uses several times the tokens of one agent. Settings > Modelling > **Sessions at once** (6 by default; `maxSessions`) limits Mochi, the specialists working and their workers together; a worker over the limit waits for a free session and says so.
- **Workers need Parallel modelling** ([parallel.md](parallel.md)); with it off, `spawn_worker` is refused and says so.

In the agent panel a specialist's workers are nested under its chip in its colour, each with its title, state and scope; a worker's approval card names the worker and waits under that chip, which shows as waiting too; the Parts list indents their claims.

### Subagents that only look

Every agent can also start Claude Code's own subagents, for reading, researching and reviewing. They are not a way to change the model: a subagent calls the app's tools with its parent's token, so the app cannot tell it apart, and changing the model with help goes through a worker instead. So every subagent HAI makes available has only the tools that read the model and the view (and `Read`, `Glob`, `Grep`): one for each other member of the team, named after it and with its way of looking at things (`product`, `climate`, `reviewer`, `mochi`), and two generic ones, `scout` (also searches the web) and `checker`. A project file for an agent of the same name cannot give a subagent more: HAI's definition is the one that runs.

### Panels with several agents

One panel is shown at a time, but an offer made while another agent's panel or offer is showing is no longer refused: it waits its turn (at most two wait, at most a minute each), the agent is told how long it waited, and it is shown to you when the first ends. An offer card and a panel name the agent that made them.

### Mochi's plan

For a request with three or more parts, or a split you may want to change, Mochi can show you the plan first (`confirm_plan`): one line per part with the agent that would do it, its title and its scope. Remove the parts you do not want and **Confirm**, or **Skip**; Mochi hands out only the parts you kept, and nothing is handed out before you answer (an unanswered plan expires after two minutes and hands nothing out).

## Agents' own cameras

To check what it made, an agent does not borrow your view. Each agent places **cameras of its own** (`camera_set`), takes pictures from them (`camera_capture`, or a preset: `iso` four corners, `top`, `front`, `left`, `orbit-sheet` eight views around the model) and deletes them (`camera_delete`). A picture is drawn by the viewer's own renderer in one step the browser never paints in between, so your camera, selection and light are the same before and after, and you can keep orbiting with your hands while it is taken. It shows the model as it is, owners' tints included, and leaves out your hover, selection, deletion marks, section cut, tool marks, claim boxes and the camera markers (ask with `selection` or `section` and they are shown). `capture_view` and `set_view` stay for what you see: the first photographs your view, the second moves your camera, and agents use it only to show you something.

- Cameras are private to the agent that placed them (at most 8 each) and go when its task ends.
- A picture is taken by one viewer window, the one you used last, not by all of them.
- **You see what they looked at:** each agent's last picture is a thumbnail in the team strip with the camera's name (click for it larger, Escape to close), and stays after its task ends until it takes another. The team strip shows each specialist as a face in its colour, with the mark of its role: Architect a hard hat, Climate a sun, Product a cube, Reviewer glasses, Simulation an orbit, Urban a skyline, any other agent an antenna. The face shows what the agent is doing: it rests with slow blinks, works with darting eyes and a moving mark, sleeps while it is queued, and looks startled with a question mark when it waits for you. Its name sits under the face while it is busy or selected; what it is doing is in its tooltip. Motion stops when your system asks for reduced motion. In Mochi's chat the strip shows every agent's picture; open one agent's thread (its chip, which is then outlined) and the strip shows only that agent's. In the model each camera is a small cone in the agent's colour with a line to what it looks at; Settings > Modelling > **Show cameras** turns the markers off.
- A sun study takes its pictures in the sun's light for those pictures only; your own light does not change.

A set of four 1024-pixel pictures takes about 0.2 s and eight about 0.3 s on a laptop with a GPU, with no gap longer than a frame or two in your own view.

## Urban, Climate and Simulation with open data

With **Open data** on (Settings > Open data, off by default, see [open-data.md](open-data.md)) three specialists can read what is known about the place. None of them changes the model.

- **Urban** finds datasets in open-data portals (`open_data_search`, `open_data_get`), fetches the neighbouring buildings and trees around the site (`urban_buildings`), the green cover and greenness (`urban_vegetation`) and works out the metrics of the site (`urban_metrics`: building coverage, mean height, green share, tree count). What it fetches is drawn in the grey **context layer** beside your model, which no hand can select. To use a neighbour in the model, Urban asks an agent that changes the model, which can adopt it (`context_adopt`).
- **Climate** gains `weather_now`, `weather_forecast` and `climate_normals` next to its sun studies. Every answer says its source and how old it is.
- **Simulation** reads the ground's temperature (`surface_temperature`: the temperature of the surface seen from a satellite, not of the air, from a scene that is days old, with its date and a colour overlay), describes the model for a simulation (`simulation_geometry`) and, when you installed the Ladybug Tools MCP server as an extension, uses it for daylight and energy studies. Each of its calls asks for your approval. Without it Simulation tells you how to install it and offers sun studies and the data above instead.

The project's **site** (latitude, longitude, where north is) is what turns a place into model coordinates. Mochi or a specialist proposes it with `site_set` and an approval card shows the values before anything is saved. Mochi sends questions about the surroundings, plants and green cover to Urban, weather questions to Climate and heat, daylight and energy questions to Simulation.

## Information panels

Every agent can show a panel, Mochi and the three above included. The panel of an agent that does not change the model is **information only**: it shows a table, a comparison or a status, has a **Close** button where a writer's panel has **Done**, and cannot move anything. A panel that tries to preview or commit a change is refused, the model does not move, and the agent is told when the panel closes. See [agent.md](agent.md#generated-panels).

## Climate's sun studies

Climate's `sun_study` tool takes a date, a local time and a place (latitude and longitude). It works out where the sun is with NOAA's solar position algorithm, moves the viewer's light there (north is +Y, as in Rhino) and returns the sun's altitude and azimuth with a picture of the view. The ground catches the shadows, so a winter study shows how far they reach. A **Sun study** badge at the top right of the model says what is shown; press **Escape**, its **×** or another tool to return to the normal light.

Local time follows the longitude unless an offset from UTC is given (`utcOffsetHours`), so give the offset for daylight saving time.

## Spoken replies

Mochi's replies and reports are spoken, sentence by sentence as they arrive, so the first sentence starts before the reply is complete. Specialists' replies, tool details and code are not spoken.

- **The voice is generated on this laptop.** Kokoro-82M (Apache-2.0) runs in a Web Worker on WebGPU, in full precision, with `phonemize` (MIT) for English pronunciation. `pnpm assets` downloads the model (325 MB) and two voices once and checks their SHA-256. Neither the reply text nor the audio is sent anywhere; an automated test checks that no request leaves the machine while Mochi speaks.
- **Without WebGPU**, a voice installed on the computer speaks instead (one that works without the network), and the Voice settings name it. Kokoro on WebAssembly is slower than real time, so it is not used (see [decisions.md](decisions.md)).
- **Talking interrupts.** Pressing the microphone, holding the talk key, pressing stop or the stop gesture (both fists, then open hands) stops the voice at once.
- **Mute** with the speaker button beside the microphone, or **Speak Mochi's replies** in the Voice settings. The choice is remembered. Choose between two voices there too.
- The Voice settings show which voice speaks and the 90th percentile of the time from a sentence being complete to its first sound. The target is under 1.2 s; on the reference laptop a short sentence takes about 1 s (measurements in [decisions.md](decisions.md)).
- The model loads when you send a request, so it is usually ready by the time Mochi answers.

## Usage

Every agent is your own Claude Code, on your own plan: up to four sessions can work at once (Mochi and three specialists), and with workers up to the session limit (6 by default). Lower `maxRunning` or the session limit if you want fewer; the panel always shows how many are working. See [PROVIDERS.md](../PROVIDERS.md).

## Troubleshooting

| What you see | What to do |
|---|---|
| "There is no specialist called ..." | Mochi asked for an agent the project does not have; add it in the Agents tab or name another |
| A specialist's task waits as queued | Another agent that changes the model is working, or three specialists are busy; it starts when they finish |
| A spoken name is not recognised | Add how it was heard as another name for the agent in the Agents tab |
| Mochi does not speak | Check **Speak Mochi's replies** and the speaker button; the Voice settings say which voice is in use, or that this computer has none |
| The sun study shows night | The time is before sunrise or after sunset at that place; check the time and `utcOffsetHours` |
