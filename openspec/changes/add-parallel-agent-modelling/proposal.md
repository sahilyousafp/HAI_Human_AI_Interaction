# Proposal

## Why

Today only one agent that changes the model works at a time (`Team.schedule`), so "Architect builds the dome, Product furnishes the hall, Architect's second pass does the gardens" is a queue, not a team. The rule exists for a good reason: the scene has one undo-group slot, no notion of who owns what, and agents (and their Python scripts) can overwrite each other's work. Research on the code found the gaps exactly: elements have no owner or tag, `scene.patch` carries no author, the scene tool handlers ignore the calling agent, and nothing stops two scripts writing the same `.3dm`.

Prior art says what to do about it. Revit avoids conflicts with worksets and per-element borrowing and shows ownership in the view; Onshape avoids blocking with microversions and per-feature ids; Rhino's Worksession locks whole files; Kleppmann's fencing tokens say the resource itself must check a claim, not trust the holder; Cognition warns that parallel writers make conflicting implicit decisions unless they share context. So the design is: **plan the split first (disjoint scopes and a shared brief), claim it, let the one authority (the bridge) enforce it, show it in the model, and check what scripts really did afterwards.**

## What Changes

- Every element carries stable, bridge-checked ids and optional **tags** (`hai.owner`, `hai.part`, `hai.source`, others), the same convention as Rhino objects' `hai.*` user strings. Elements an agent creates are stamped with its name. Agents can list and filter by owner, part and tag.
- A **claim** is a task's right to change a named scope: element ids, a part (tag), or a region (a box in millimetres). Mochi gives each specialist task a scope and a short **shared brief** (datum, grid, proportions, colours) when it delegates. Writing tasks whose scopes do not overlap run **at the same time**; overlapping or unscoped ones queue exactly as today, so nothing gets worse.
- The scene tools check every create, update, delete and tag against the caller's claim and refuse with a message that names the holder. Agents can read all claims and ask for more scope (`request_claim`); a claim is released when its task ends, however it ends.
- Undo grouping becomes **per agent**: each agent's task is still one labelled undo step, and patches say who made them.
- Python and Rhino scripts cannot be sandboxed, so they get **declared scope plus a check afterwards**: `python_run` declares the files it will write and they are reserved; `rhino_run_python` runs with the task's claim, the plugin stamps the objects it creates, and a before/after diff reports anything changed outside the claim to the agent and the user.
- The viewer and agent panel **show who owns what**: an owner outline or tint in the agent's colour on scene elements and mirrored Rhino objects, the claimed region as a translucent box, and a Parts list (agent, scope, element count) that highlights its elements on hover.
- A feature switch **Parallel modelling** (on by default for new projects, off restores the single-writer rule).
- **BREAKING**: the spec's "only one agent that changes the model works at a time" becomes "writers with disjoint scopes work at the same time". Element schema gains an optional `tags` field (older bridges reject new files that use it).

## Capabilities

### New Capabilities
- `part-ownership`: stable element ids, tags, owner stamping, parts, and reading and filtering the model by them.
- `edit-claims`: scopes, the shared brief, claim-aware scheduling, enforcement in the scene tools, release, and the declared-scope-plus-check model for Python and Rhino scripts.
- `ownership-display`: owner tint and outline, claimed-region box, the Parts list, and the Parallel modelling switch.

### Modified Capabilities
- `agent-team`: the scheduler requirement ("Work is scheduled safely") changes from one writer to disjoint scopes; delegate takes a scope and a brief; the team strip shows claims.
- `scene-model`: elements gain `tags`; undo grouping is per agent; patches carry their author.
- `scene-tools`: tools learn who is calling; read tools filter by owner, part and tag; new tools for claims and tags.

## Impact

- `packages/protocol`: `Element.tags`, `ScenePatch.by`, `TeamTask.scope`, claim messages, `ViewRequest`-style additions, `rhino.python.run` carries agent, title and claim, `RhinoPythonResult.changes`.
- `apps/bridge`: `SceneStore` (per-agent groups, author on patches), a new claim table, `Team.schedule`, scene tool handlers and new tools, python run reservation, Rhino run diff.
- `apps/web`: viewer owner display, Parts view, scene client author, importer keeps `hai.source`.
- `plugins/rhino` (C#): run-scoped stamping and diff; unverifiable without a real Rhino 8.
- Docs: `docs/agents.md`, `docs/agent.md`, a new `docs/parallel.md`.

**Out of scope:** sandboxing scripts; merging concurrent edits to the same element (claims prevent it); sub-element ids such as faces (split the object instead); per-agent selection (selection stays global); several generated panels at once (the single panel slot stays); a per-user (human) lock, so the user can still edit anything and is told what they touched; a second bridge or remote agents; recovering a model damaged by an unsandboxed script other than through undo.

**Demo clip (45-60 s):** `demos/16-parallel-agents.md` - "Three agents, one model". The user asks for a pavilion; Mochi splits it into dome, hall and garden with a shared brief; three tinted regions appear and fill in at the same time in three agent colours; one agent tries to touch another's wall and is refused with the owner's name; one undo reverts one agent's part.
