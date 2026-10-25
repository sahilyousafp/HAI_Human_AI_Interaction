# Parallel modelling

Several agents can change the same model at the same time, each in its own part of it. HAI makes this safe in one place, the bridge, so a model that ignores its instructions still cannot overwrite another agent's work, and you can always see who owns what.

It is a feature (Settings > Features > **Parallel modelling**, on by default). Off, one agent changes the model at a time, as before, and nothing below is drawn.

## Scopes: who may change what

A task Mochi hands to a specialist can carry a **scope**, the part of the model that task may change. A scope is any mix of:

| Part of a scope | Meaning |
|---|---|
| `part` | A name. The task's new elements are tagged with it (`hai.part`), and the task may change every element that has that tag |
| `ids` | Element ids. Use for elements that already exist |
| `region` | A box in millimetres, `min` and `max` as `[x, y]` (any height) or `[x, y, z]`. A task may change elements that meet it, and create elements wholly inside it |

A task with **no scope claims the whole model**, so it runs alone, as every task did before. That is also what old projects, agents you edited and hand-typed requests get.

Mochi is told to split a request that spans separate parts (a dome and a garden) into one task per part, each with a scope that does not overlap the others, and to write one **brief** for all of them: the datum, grid, key dimensions, colours and style the parts must agree on. Scopes stop one agent overwriting another; the brief is what stops a dome in one style on a hall in another. Every specialist starts its task with the brief, and any agent can read it again with `get_claims`.

## What runs at the same time

- Writers whose scopes do not overlap run together, up to the team's limit of three at once.
- A task whose scope overlaps a running task's, or that has no scope, **queues** and says why: the panel shows "waits for Architect's task". It starts the moment the claim it waits for ends.
- A later task that overlaps an earlier queued one waits behind it, so a task that needs the whole model is not starved by small ones that keep starting.
- Agents that only read (Climate, Reviewer) work alongside whatever the writers' scopes are.
- If Mochi hands out two overlapping tasks, it is told so in the hand-off's reply, so it can split better next time.

Overlap is decided from the model as it is: two parts overlap when an element of one lies in the other's region or ids, two regions overlap when they share volume (touching edges do not count), and an unknown id counts as nothing.

## Claims are enforced where the model changes

Every create, update, delete and tag change an agent makes is checked, as a whole batch, against that agent's claim and everyone else's. A change outside the claim, or to something another running task holds, is **refused with nothing changed**, and the message says what is claimed by whom and what to do:

> Nothing was changed: "wall-h1" is claimed by product's task "hall" (the part "hall"). You can ask for more with request_claim, leave it to its owner, or tell the user.

- An element two claims could both hold belongs to the one granted first.
- What an agent creates inside its scope joins its claim at once.
- An agent with no running task (after it ended, or a late call from a stopped process) cannot change the model.
- **You can change anything.** Your edit to an element a running task holds is made, and that agent hears of it at its next read: `get_elements` marks the element `changedByUser`, once.
- The claim ends with its task, whether it finished, failed, was stopped, was taken off the queue or crashed, and when the project changes. Stopping a task frees its scope within 3 seconds.
- Checking a batch of 100 elements in a model of 5000 takes well under 5 ms.

Agents manage their claim with three tools: `get_claims` (who holds what, who waits, the brief), `request_claim` (more ids, a part or a region; granted at once when nothing else holds it, refused naming the holder otherwise) and `release_claim` (give some back, so queued tasks can start).

## Workers

A specialist can cut its own claim into parts for **workers** ([agents.md](agents.md#workers)). A worker's claim is a child of its specialist's: it lies inside it, never overlaps a sibling, and what a running worker holds the specialist cannot change (the refusal names the worker). Parts are hierarchical: a claim for the part `pavilion` takes in `pavilion/dome` and `pavilion/minarets`, which are disjoint from each other. When a worker ends, its part returns to the specialist, and each worker's changes are their own undo step.

## Ids, owners and tags

Every element has an id that is unique in the project and never changes. When an agent gives none, the bridge makes one (`wall-1f3a9c2e`); a create with an id that exists is refused, and says who owns it.

Every element can carry **tags**: names up to 64 characters, values up to 200, at most 20. Names starting with `hai.` are the system's:

| Tag | Set by | Meaning |
|---|---|---|
| `hai.owner` | The bridge | The agent that made the element, or last changed one that was not its own |
| `hai.part` | The bridge | The part the creating task works on |
| `hai.source` | The importer | The file and the object's id in it (`tower.3dm#<id>`), left off when a big model's objects are merged per layer |

Agents never write these: a change that adds, changes or removes a `hai.` tag is refused, so an agent cannot give an element to another owner. They can add their own tags with `set_tags`. Tags are saved in the project, undoable like any change, and optional: a project saved before tags loads as it was. (An older HAI cannot open a project that uses them.)

`get_elements` filters by `owner`, `part` and `tag`, and `get_scene_summary` counts the elements each owner and part holds. While Rhino is connected, the Rhino objects' `hai.*` user strings are listed in the same answers, so one question covers both.

## One undo step per agent

Each agent's work in a task is its own undo step, labelled "Architect: Dome", even while others work at the same time. Disjoint claims make the steps commute: undoing one agent's step never touches another's elements. A user undo while agents work records what each has done so far as a step, they carry on in a new one with the same label, and the newest step is undone. Every change sent to the pages says who made it.

One weak spot is unchanged: undo restores old values, so undoing an agent's step also undoes your own later edit to the same element.

## Scripts

Python and Rhino scripts are not sandboxed, so for them HAI reserves what it can and reports the rest.

- **Python.** `python_run` takes `outputs`, the `.3dm` files the script will write. They are reserved for the task: a run that names a file another task reserved is refused, naming it. Only the declared files are offered to you; a `.3dm` that changed during the run without being declared is shown as a notice ("changed during a run, outside what it declared") and reported to the agent. The approval card lists the files the script will write. Kept scripts never share a name, even for two runs with one title in one second.
- **Rhino.** Rhino runs one script at a time on its user-interface thread, so the bridge queues them: agents plan in parallel, their scripts take turns, each as its own undo step, and a script's time limit starts when Rhino gets it. Each script carries the agent's name, its title and its claim. The plugin stamps every object the script adds with `hai.owner` and `hai.part`, and compares every object before and after. The bridge checks that against the claim **after the run**: anything the script added, changed or deleted outside it is reported to the agent and to you, with **Undo in Rhino**. This cannot prevent a change, and says so.

## Seeing it

- **Owners in the model.** An element an agent owns is outlined and tinted in that agent's colour; Rhino objects with `hai.owner` too. Selection, hover and the pending-deletion mark stay on top of it. A region claim is drawn as a translucent box in the agent's colour until its task ends.
- **Parts list** in the agent panel: one row per running claim (agent, task, what it holds, how many elements). Pointing at a row lights its elements in the model. A task waiting on a claim says which.
- The team chips carry the same claim line.

The panel shows a claim within 200 ms of it being granted (measured 44 ms at the 90th percentile).

Settings > Modelling > **Show owners** turns the tint and the boxes off while keeping parallel work; the panel still lists the claims.

## Checking it by hand

On Rhino 8, with the plugin's Python runner once it exists: hand two scoped tasks to Architect and Product that each run a script adding surfaces. Both should list their claims; the new objects should carry `hai.owner` and `hai.part` in Rhino's user strings; one undo in Rhino should revert one script. Then run a script that moves an object of the other task's part: the panel should report it with **Undo in Rhino**.

## Where things live

| What | Where |
|---|---|
| The claim table and its rules | `apps/bridge/src/agent/claims.ts`, `packages/scene/src/claim-scope.ts` (shared with the viewer) |
| Checking and stamping an agent's change | `Team.vet` in `apps/bridge/src/agent/team.ts`, `ownership.ts` |
| The scheduler | `Team.schedule` |
| Per-agent undo groups | `apps/bridge/src/scene-store.ts` |
| The after-the-run check for Rhino | `apps/bridge/src/agent/rhino-run-check.ts` |
| Claims on the wire | `team.snapshot` (`claims`), `scene.patch` (`by`), `rhino.python.run` (`agent`, `title`, `part`, `claim`), `rhino.run.report` |
