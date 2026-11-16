# Tasks

## 1. The contract (`packages/protocol`)

- [ ] 1.1 Add `host.ts` (`HostId`, `HostObjectType`, `HostObject`, `HostNotDrawn`, `HostSync`, `HostBatch`, `HostSelected`, `HostChange`, `HostRunChanges`, `HostRunResult`, `HostCapabilities`). Move `ViewRequest` and `VIEW_MODES` to `view.ts` and delete `rhino.ts`. Verify by moving `rhino.test.ts` to `host.test.ts`, adding cases for the Blender and Revit object types.
- [ ] 1.2 Replace the `rhino.*` messages with the `host.*` messages of the design, with `host.refused` and the versioned hello. Verify the schema tests, including "an old hello without a protocol version is refused".
- [ ] 1.3 Add `HostComponent`, `host.describe` and `host.described`, the described components on `host.selection`, and `components` in `RequestContext`. Verify the schema tests, including the 100-property and 200-character limits.
- [ ] 1.4 Add the tool names and the `host` and `hostRead` groups to `HAI_TOOLS`, removing `rhino` and `rhinoRead`. Verify with `pnpm typecheck` across the workspace, which lists every place still to move.

## 2. The bridge: registry and links

- [ ] 2.1 Rename `host-link.ts` to `desktop-link.ts` (the Electron parent link) with its test. Verify the desktop e2e start-up test still passes.
- [ ] 2.2 Move `RhinoLink` to `hosts/host-link.ts`, generic over the host, and add `hosts/registry.ts` (one link per host, a second connection replaces the first, the set in use from the settings). Verify by moving `rhino-link.test.ts` to `hosts/host-link.test.ts` and running it against a parameterised fake host as `rhino` and as `blender`.
- [ ] 2.3 Add `hosts/rhino.ts`, the adapter (strengths, language, `# r:` package parsing, run hint). Verify by moving the `# r:` parsing tests into it.
- [ ] 2.4 Accept token-only connections for every `HostId`, refuse the old hello with its message, and greet a page with one `host.state` per known host. Verify "any host id connects with the token", "an old plugin is refused" and "the mirror reaches a late page" for two hosts.
- [ ] 2.5 Generalise `agent/rhino-run-check.ts` to `agent/run-check.ts`. Verify the strays tests and `parallel.test.ts` for runs on a host.
- [ ] 2.6 Replace `modelling` with `hosts` in `settings.ts`, with the migration from `python` and the other values. Verify "an old Python only choice" and "switch a host off" in the settings tests.

## 3. The agent's tools

- [ ] 3.1 Add `mcp/host-tools.ts` with `host_list`, `host_read` and `host_run` (approval with the host and packages, per-host always allow), replacing `rhino-tools.ts` and the Rhino tools in `scene-tools.ts`. Verify, by moving `python-tools.test.ts` cases: "a script changes the document", "output and result come back", "an error is returned", "output is capped", "the host is named", "a run waits for the user", "a package is listed", "always allow is per host" and "time limit".
- [ ] 3.2 Add `host_capture` (request, the asset upload, reading the asset, dropping it after 10 minutes, timing in the tool chip). Verify "capture Rhino's view" with the fake host and a 1.5 s budget check in the bridge test.
- [ ] 3.3 Add `host_place_image` (path checks against the project, claim check, undo label) and `host_api`. Verify "a site photo behind the model", "outside the project" and "look up a Rhino method" with the fake host.
- [ ] 3.4 Grant tools by role in `roster.ts` and `agent-config.ts`, and offer host tools only for hosts in use, with descriptions naming them. Verify "roles get their tools", "Reviewer cannot run code in a host" and "no host, no host tools" in `roster.test.ts` and `agent-config.test.ts`.
- [ ] 3.5 Migrate saved approvals and old tool names in agent files in `legacy.ts`. Verify "old approvals carry over" and a unit test for an agent file naming `rhino_run_python`.
- [ ] 3.6 Describe each selection 150 ms after it changes, keep it with the selection, send it to the viewer, put it in a request's context, and add `host_describe`. Verify "a selected Brep is described", "a request knows what 'this' is" and "describe by id" with the fake host, and the 300 ms budget for 50 objects.
- [ ] 3.7 Name the host in the user context (pointed object and selections) in `scene-tools.ts`, and frame every host's bounds in `agent-eyes.ts`. Verify "'this' in Rhino" and "two hosts' selections".

## 4. The viewer and the HUD

- [ ] 4.1 Move `apps/web/src/rhino/` to `apps/web/src/hosts/`: the mirror store keyed by host, one `MirrorLayer` per host in use, and picks as `{ host, id }` that clear the other hosts. Verify the mirror unit tests and "two hosts at once" and "a host disconnects" in `e2e/hosts.spec.ts` (moved from `e2e/rhino.spec.ts`).
- [ ] 4.2 Add the host chips to the HUD (glyph, name, connected, p90, not-drawn counts, run status and how to fix it). Show the glyph options to the owner in an Artifact first. Verify "latency readout", "curves are counted" and "run unavailable" in e2e. Check screenshots at 1280, 1024 and 900 px and run `e2e/hud-layout.spec.ts`.
- [ ] 4.3 Replace Settings > Modelling with Settings > Hosts (a switch, status and how to connect, per host; the owner and camera switches). Verify "switch a host off" in e2e and update the settings screenshots.
- [ ] 4.4 Move the remaining readers of the Rhino state (`agent-client.ts`, `import/`, `export/`, `Viewer.tsx`, `App.tsx`). Verify the unit tests and `e2e/import.spec.ts`, `e2e/project-files.spec.ts`, `e2e/parallel.spec.ts` and `e2e/visual/rhino.visual.spec.ts` (renamed to `hosts.visual.spec.ts`; baselines renamed, not regenerated, unless the pictures differ and the difference is looked at).

## 5. The Rhino plugin

- [ ] 5.1 Move the message models to `HAI.Rhino.Core/Protocol.cs` with `host: "rhino"` and the versioned hello. Add a contract test in which C# writes one fixture per message and `packages/protocol` parses them. Verify `dotnet test` and the protocol tests.
- [ ] 5.2 Add the C# job to CI on windows-latest (`dotnet test` for the core library, build for the plugin), carried over from `add-rhino-connector` 2.4. Verify it runs green.
- [ ] 5.3 Connect, discovery, reconnect within 5 s and the command-line messages, including the refusal, carried over from 3.1. Verify "connect", "bridge not running", "bridge restart" and "an old plugin is refused" by the manual script in Rhino 8 and 9.
- [ ] 5.4 Check the mirror, selection both ways and the not-drawn counts in the viewer with a real Rhino, carried over from 3.2 to 3.4. Verify "a new object appears", "a moved object follows", "a deleted object goes", "Rhino minimised", "tap selects a Rhino object" and "mouse selection mirrored" by the manual script, and record the p90.
- [ ] 5.5 Add `Capture.cs` (`ViewCapture`, named views, asset upload). Verify by the manual script in Rhino 8 and Rhino 9's Direct3D display, recording the time at 1280 x 720.
- [ ] 5.6 Add `PictureFrames.cs` (`AddPictureFrame`, embedded, one undo record) and `ApiLookup.cs` (a reflection index built after connect). Verify by the manual script: one Undo removes the frame, and a lookup of `Brep.CreateFromLoft` answers in under 300 ms.
- [ ] 5.7 Add `Describe.cs` (user strings, material, area and volume with a 10 ms cap per object). Verify by the manual script on a closed Brep, an open surface and a block, and unit-test the property limits in `HAI.Rhino.Core`.
- [ ] 5.8 Show the run status on the host chip, and the run timing in the tool chip, carried over from 5.5. Verify in e2e with the fake host that a trivial run's overhead stays under 500 ms.

## 6. Docs

- [ ] 6.1 Write `docs/hosts.md` (the contract, Settings > Hosts, the tools, approvals per host, captures and images, that nothing is sandboxed) with a Rhino section from `docs/rhino.md`, which it replaces, carried over from 7.1. Update `docs/agents.md`, `docs/tools.md`, `docs/settings.md`, `SECURITY.md` and the README links. Verify the steps on a clean Rhino 8 profile.

## 7. Demo

- [ ] 7.1 Write `demos/23-host-adapters.md` ("One contract, any app": Rhino minimised, a canopy by `host_run`, Rhino's own capture compared with HAI's, the site photo placed in Rhino, Settings > Hosts), carried over from `add-rhino-connector` 8.1. Record the clip. Verify on the maintainer's Rhino 8 and 9, with the p90 and the capture time recorded.
