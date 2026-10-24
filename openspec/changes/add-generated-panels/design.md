# Design

## Context

The viewer's HUD is DOM laid over the canvas (`apps/web/src/viewer/Viewer.tsx`), and the hands press anything marked `data-hand-press`. The scene lives in the bridge: the browser's `SceneClient` sends `scene.apply` and receives `scene.patch`, and `applyTransaction` from `@hai/scene` can apply operations to a document locally. Nod and shake are routed to one yes/no target at a time in `App.tsx`. The agent's `hai` tools are registered in `apps/bridge/src/mcp/scene-tools.ts`, and each agent sees only the tools its definition lists (`allowedHaiTools` in `roster.ts`), without the model-changing ones unless it is marked as writing.

Nothing in the repo yet runs generated code in the page: no frame, no CSP, no sandbox. The page also holds the session token (`window.__HAI_SESSION__`), which is why a generated panel must never share its origin. See proposal.md - Why for the motivation.

## Goals / Non-Goals

**Goals:**
- Nod to visible panel frame within 150 ms, measured in the end-to-end test with the fake camera from the injected nod event to the frame being in the DOM.
- A panel control moves the model on screen within one drawn frame plus one message hop (under 50 ms in the end-to-end test).
- A hostile or broken panel can do nothing except fail itself and send validated scene operations.

**Non-Goals:**
- Making generated panels beautiful by themselves; the shared theme and control styles carry that, and the quality of the HTML is the agent's.
- Keeping any panel after it is closed (see the proposal's out of scope).
- A general plugin or extension system for third-party UI.

## Decisions

**1. The panel runs in `<iframe sandbox="allow-scripts" srcdoc=...>` with no `allow-same-origin`.** The frame gets an opaque origin, so it cannot read the page's DOM, `window.__HAI_SESSION__`, storage or cookies, and the bridge refuses its requests anyway (the Origin is `null`, not on the allow-list, and it has no token). No `allow-forms`, `allow-popups`, `allow-modals` or `allow-top-navigation`. Three layers, each enough for the common attacks on its own: the sandbox flags, a CSP set both as the iframe `csp` attribute and as the first element of the document (`default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; frame-src 'none'`), and the bridge's own token and Origin checks. Rejected: same-origin `srcdoc` (can read the token); injecting the HTML into the app's DOM or a Shadow DOM (full access to the page); `eval` or `new Function` in the app's realm (same); a panel server on another port (more moving parts for a loopback tool, and still needs a frame).

**2. A MessageChannel is the only way out.** After the frame loads, the host sends one `MessagePort` into it; the injected runtime exposes it as a small `hai` object, and everything else on `window.parent` is unreachable. The host validates every message with zod and the existing `SceneOp` schema. The panel's surface is: `hai.scene.get(query)`, `hai.selection`, `hai.on("scene" | "selection" | "theme", callback)`, `hai.preview(ops)`, `hai.commit()`. Rejected: `window.postMessage` with an origin check (an opaque-origin frame has no origin to check, so identity would rest on `event.source` alone; a dedicated port is stricter and simpler); letting the panel call MCP tools (it would give generated code the agent's powers).

**3. Previews live in the browser, in a viewer-local layer.** `hai.preview(ops)` replaces the panel's current preview. The viewer shows `applyTransaction(doc, previewOps)` in place of the committed document, rebuilt at most once per animation frame (the canvas uses `frameloop="demand"`, so a preview invalidates one frame). The bridge's scene is not touched: no round trip per slider tick, no undo step, no project write, and the agent and other clients see only committed state. When a patch from the bridge arrives, the preview is re-applied over the new document; if it no longer applies (for example the element was deleted), the preview is dropped and the panel is told. `hai.commit()` and Done send the current preview as one `scene.apply` labelled with the panel's title. Rejected: sending each tick as `scene.apply` (a bridge round trip per tick, an undo entry per tick unless coalesced, and the agent and a saved project would see half-finished states); incremental preview operations (the replace-whole-set model is trivially correct after any drop or reconnect).

**4. Done and Close belong to the host.** The frame's header and footer (title, drag handle, Done, Close) are outside the iframe, so the generated document cannot hide, move or imitate them. The iframe is clipped to its own box and cannot overlay the host. The panel can commit from its own controls (an "Apply" it draws), but it cannot close itself or the host.

**5. The offer is a blocking tool call; the panel is not.** `offer_panel` is answered like an approval card: the call waits for the user's answer (accepted, skipped or expired after 60 s) and returns it, so the agent knows what to do next within the same turn. `open_panel` returns as soon as the frame has loaded or failed (`ready` or `failed` with the reason), because a turn that waits for the user to finish playing with a slider would hold the single model-changing lane in the team scheduler. When the panel closes, the bridge delivers a short note to the agent that opened it ("the user closed the panel 'Clearance' and kept the result"), as a new turn when the agent is idle, the way Mochi's report is delivered. Rejected: `open_panel` blocking until close (holds the lane and the turn); polling (wasted turns).

**6. Offer state is a small per-agent state machine in the bridge.** `none -> waiting -> accepted -> open -> none`. `open_panel` is refused unless the state is `accepted`; `offer_panel` is refused unless `none`; closing returns to `none`. One panel exists at a time across agents. The browser mirrors the state for display only.

**7. Panel tools are granted by the bridge to every agent marked as writing.** `allowedHaiTools` adds `offer_panel`, `open_panel`, `update_panel` and `close_panel` for writing agents, whatever their definition file lists, because HAI never overwrites a definition the user has changed and existing projects would otherwise never see the tools. Mochi does not write, so Mochi delegates to Architect or Product, which offer the panel. Rejected: editing the agents' files (breaks the "never overwrite" rule); making Mochi write (breaks the single model-changing lane).

**8. The panel API is documented in the `open_panel` tool description.** It is always current, travels with the bridge version, and does not depend on the agent files. It lists `hai`, the element schema pointers already used by `create_elements`, the base control styles and the hand-input rules (decision 10), and tells the agent to keep a panel small, labelled with units, and to show the tolerance state in the panel. Rejected: the agent files (stale and user-edited).

**9. Theme and base styles are injected.** The host puts the HUD's CSS custom properties and a small base stylesheet (range, number, checkbox, button, label, `output`, table, spacing) before the generated document, and sends `theme` events over the port when the app theme changes. A panel with plain HTML and no styling looks like the rest of the HUD. Rejected: leaving styling to the agent (inconsistent and ugly in dark mode).

**10. Hand input is forwarded to the frame.** The host cannot hit-test inside an opaque-origin frame, so the hand layer treats the frame as one press target and sends `{ phase, x, y }` in frame coordinates over the port. The runtime resolves the element with `elementFromPoint` and acts on it by kind: a button, checkbox or radio gets `click()`; a range input gets its value set from the x position and `input` and `change` events dispatched (untrusted pointer events do not move a native range input, so synthetic mouse events are not enough); a number input is focused for typing. Selects are not supported by hand and the tool description tells the agent to use buttons. The host also enforces a minimum control size in the base stylesheet so hand presses can hit them. Rejected: `allow-same-origin` to reach into the frame (breaks decision 1); drawing the panel as canvas (no HTML, no real-time custom code).

**11. A panel commit is a direct edit.** It is labelled with the panel's title and is a single undo step, like any edit the user makes by hand. If `add-agent-turn-review` lands first it treats a commit as a direct edit (it accepts a pending review, and blocks it while a turn runs); this change adds no blocking rule of its own. Nod and shake precedence is in the `agent-panel` delta.

**12. Limits.** A document is limited to 256 KB. The host accepts at most 60 port messages per second per panel and drops the rest with a message back to the panel, and the preview is rebuilt at most once per frame, so a runaway script cannot starve the viewer. A frame that throws on load shows a failed state in its header and reports it to the agent as `failed`.

## Latency budget

| Step | Budget | Measured |
|---|---|---|
| Nod event to panel frame in the DOM | 150 ms | Playwright, fake camera, injected nod to the frame element appearing |
| Panel control to model change on screen | one frame plus one message hop, under 50 ms | Playwright, range value set to the next frame whose scene differs |
| Panel HTML written by the agent | not budgeted (the model's speed) | the loading state covers it and navigation never waits |

## Risks / Trade-offs

- [The agent writes poor or broken HTML] -> A loading state and a visible failed state, a base stylesheet that makes unstyled HTML acceptable, a tool description with a working example, and `update_panel` so the agent can fix it.
- [Hand presses inside the frame feel different from the native page] -> The runtime handles the three kinds of control the tool description allows, and the end-to-end test drives them with injected hand events. Anything else (selects, text selection) is documented as mouse or keyboard only.
- [A panel's commit changes the model without the agent knowing the values] -> The agent is told the close outcome and can read the committed elements; the commit is one labelled undo step.
- [A script floods or loops] -> Message rate limit, one frame per preview, and the iframe's own process isolation in Chromium; the panel can be closed from the host at any time.
- [CSP `csp` attribute on iframes is Chromium-only] -> The product targets Chrome and Edge; the in-document CSP and the sandbox flags still apply in other browsers.
- [Nod/shake targets multiply] -> The order is fixed in the `agent-panel` delta and tested; `add-agent-turn-review` ranks below the panel offer when both exist and should add its own scenario.

## Migration

None. Existing projects get the panel tools without any change to their agent files (decision 7). The feature switches in the settings sheet gain a "Generated panels" switch, on by default, that removes the panel tools when off.

## Open Questions

- Whether Product should also be told about panels in its default instructions or only receive the tools. This can be decided after the first demo without changing the specs.
