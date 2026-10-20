# The agent team

AEX gives you a small design team made of your own Claude. **Mochi** leads it: every request goes to Mochi, which answers questions itself and hands design work to **specialists**. Each specialist works on its own task while Mochi stays free, so you can ask Mochi what everyone is doing at any time. Mochi tells you when the work is done, and says it out loud.

## The team

| Agent | What it does | Changes the model |
|---|---|---|
| **Mochi** | Takes every request, hands work to the specialists, reports what everyone is doing. Runs on Claude Sonnet. | No |
| **Architect** | Massing, levels, walls, slabs, columns, cores and stairs | Yes |
| **Product** | Furniture, fixtures and components at product scale | Yes |
| **Climate** | Sun path, shadows, orientation and daylight (sun studies) | No |
| **Reviewer** | Checks the model against the brief and common rules, and reports issues. Never edits. | No |

The team is written into the project the first time you send a request: one Claude Code agent file per agent in `.claude/agents/`. AEX never overwrites a file you have changed. Because they are Claude Code's own agent files, the same agents also work when you run `claude --agent architect` in a terminal.

## How it works

- **Each agent is its own Claude Code session.** The bridge starts `claude -p --agent <name>` for each agent when it first has work, in the project folder, with your own Claude Code setup (see [agent.md](agent.md) for the exact command). Each keeps its own conversation (`.aex/agent/<name>/session.json`), so Architect remembers its earlier tasks, and each resumes after a crash, an idle close or a restart.
- **Mochi hands out tasks.** It calls `delegate` with a specialist's name, a short title and a complete instruction. That returns at once, so Mochi's turn ends and Mochi is free for your next question while the specialist works.
- **Each agent only has its own tools.** Every session gets its own random token for the app's tool server. From the token the bridge knows which agent is calling and offers it only the `aex` tools its definition lists. Reviewer has no tool that changes the model at all, and an agent marked as not changing the model never gets those tools, whatever its file lists.
- **Mochi reports.** When every task Mochi handed out in one turn has finished, the bridge sends Mochi a short report (each task's agent, outcome and the specialist's summary) and Mochi tells you what was done. A report waits while you are talking to Mochi.

The first time you used AEX in a project before the team existed, that one conversation becomes Mochi's, so nothing is lost.

## Asking the team

- **Just ask.** "Add a stair core here", "how many floors does the tower have?" Mochi decides who does what.
- **Name a specialist** to choose who does it: "Architect, add a stair core here." The name is taken out of the request and Mochi hands the rest to Architect. Typed requests work the same way, and `@architect` anywhere in a typed request does too.
- **Ask Mochi to delegate**: "Mochi, ask Climate to run a winter shadow study."
- **Ask for status** whenever you like: "Mochi, what is everyone doing?" Mochi answers from the live task board (each agent's task, its latest activity and anything queued) while the specialists keep working.

Names are matched forgivingly, because speech recognition mishears them. The first one or two words are compared with each agent's name and its other names, ignoring case and punctuation and allowing one letter of difference. The defaults include the mishearings measured on the reference laptop ("Machi" and "Maci" for Mochi, "Review or" for Reviewer). Add your own under the agent in the **Agents** tab.

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
| `finishedKept` | 30 | Finished tasks kept on the board and in status answers |
| `summaryChars` | 600 | A specialist's final reply is shortened to this for the board, status and Mochi's report |
| `activityThrottleMs` | 250 | Streaming text updates the board at most this often |

These values live in `apps/bridge/src/agent/team.ts`; a unit test checks that this table matches it.

- **One task per agent at a time.** A second task for a busy agent waits for the first.
- **One agent changes the model at a time.** A task for an agent that changes the model waits while another such task runs. Agents that only read (Reviewer, Climate) work alongside. This keeps every change attributable and undoable.
- **One undo per specialist task.** Everything a specialist changes in one task is a single undo step, labelled with the agent and the task, for example "Architect: Stair core".

## Stopping

- **One task:** open it from the team strip or its hand-off chip and press **Stop**, or ask "Mochi, stop Architect". A queued task is taken off the queue.
- **Everything:** press **Stop all** in the team strip or the stop button, or hold up both open palms. Mochi's turn and every task stop, and no report follows.
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
| What it may do | Its `aex` tools: read the model, change the model, sun studies |
| Other Claude Code tools | Any other tools it may use, for example `Read` or `WebSearch` |
| Instructions | The file's body |
| Other names it is heard as, colour | `.aex/agents.json` |

A change applies from that agent's next task: its session restarts with the new definition and resumes its conversation. A new agent is in Mochi's team list from Mochi's next request. You can also edit the files directly; AEX reads them again before every request and task.

## Climate's sun studies

Climate's `sun_study` tool takes a date, a local time and a place (latitude and longitude). It works out where the sun is with NOAA's solar position algorithm, moves the viewer's light there (north is +Y, as in Rhino) and returns the sun's altitude and azimuth with a picture of the view. The ground catches the shadows, so a winter study shows how far they reach. A **Sun study** badge at the top right of the model says what is shown; press **Escape**, its **×** or another tool to return to the normal light.

Local time follows the longitude unless an offset from UTC is given (`utcOffsetHours`), so give the offset for daylight saving time.

## Spoken replies

Mochi's replies and reports are spoken, sentence by sentence as they arrive, so the first sentence starts before the reply is complete. Specialists' replies, tool details and code are not spoken.

- **The voice is generated on this laptop.** Kokoro-82M (Apache-2.0) runs in a Web Worker on WebGPU, in full precision, with `phonemize` (MIT) for English pronunciation. `pnpm assets` downloads the model (325 MB) and two voices once and checks their SHA-256. Neither the reply text nor the audio is sent anywhere; an automated test checks that no request leaves the machine while Mochi speaks.
- **Without WebGPU**, a voice installed on the computer speaks instead (one that works without the network), and the Voice settings name it. Kokoro on WebAssembly is slower than real time, so it is not used (see [decisions.md](decisions.md)).
- **Talking interrupts.** Pressing the microphone, holding the talk key, pressing stop or holding up both palms stops the voice at once.
- **Mute** with the speaker button beside the microphone, or **Speak Mochi's replies** in the Voice settings. The choice is remembered. Choose between two voices there too.
- The Voice settings show which voice speaks and the 90th percentile of the time from a sentence being complete to its first sound. The target is under 1.2 s; on the reference laptop a short sentence takes about 1 s (measurements in [decisions.md](decisions.md)).
- The model loads when you send a request, so it is usually ready by the time Mochi answers.

## Usage

Every agent is your own Claude Code, on your own plan: up to four sessions can work at once (Mochi and three specialists). Lower `maxRunning` if you want fewer; the panel always shows how many are working. See [PROVIDERS.md](../PROVIDERS.md).

## Troubleshooting

| What you see | What to do |
|---|---|
| "There is no specialist called ..." | Mochi asked for an agent the project does not have; add it in the Agents tab or name another |
| A specialist's task waits as queued | Another agent that changes the model is working, or three specialists are busy; it starts when they finish |
| A spoken name is not recognised | Add how it was heard as another name for the agent in the Agents tab |
| Mochi does not speak | Check **Speak Mochi's replies** and the speaker button; the Voice settings say which voice is in use, or that this computer has none |
| The sun study shows night | The time is before sunrise or after sunset at that place; check the time and `utcOffsetHours` |
