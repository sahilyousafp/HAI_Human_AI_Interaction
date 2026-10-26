# Security

HAI drives an AI agent on your machine, so its local surface is treated as security-sensitive.

## How HAI protects your machine

- **Loopback only.** The bridge listens on `127.0.0.1` and refuses to start on any other address. No other device on your network can reach it.
- **Session token.** Each bridge start creates a random 32-byte token. A WebSocket connection must present it, and tokens are compared in constant time.
- **Origin allow-list.** Connections must come from the HAI web app's own origin. A random website open in another tab cannot connect, even if it guesses the port.
- **Token stays local.** The token is written to `.hai/session.json` (git-ignored) and injected into the dev page. The dev server sends no CORS headers, so other origins cannot read the page.
- **Camera frames stay on device.** Video is processed inside a browser worker. Only hand and face landmarks leave it. Nothing is recorded or uploaded.
- **Open data is off until you switch it on, and carries a place, never your work.** With it on, the bridge (not the page and not an agent) asks the hosts listed in Settings > Open data over HTTPS for the weather, buildings, vegetation and ground temperature around the project's site. A request holds a place, an area, a time or a search text: never your model, element names, file paths, camera pictures, voice or conversation. It never uses an account or a key, refuses any other host and any address on a private network (checked as the connection is made, so a redirect or a lookup that changes cannot get past it), and ends after 10 seconds or at a size limit. Every request is listed in Settings. See [docs/open-data.md](docs/open-data.md).
- **Your agent credentials are never touched.** See [PROVIDERS.md](PROVIDERS.md).
- **Generated panels are sandboxed.** The agent can write a small panel for you, and you open it with a nod. It is code an agent wrote, so it runs where it can reach nothing but the scene. See below.

## Generated panels

A panel is one HTML document the agent wrote, shown in a frame over the model. It is treated as untrusted code, and three layers each stop the common attacks on their own: the frame's sandbox flags, a content security policy, and the bridge's own token and origin checks.

- **Isolated from the app.** The frame is `sandbox="allow-scripts"` with no `allow-same-origin`, so its origin is opaque. It cannot read the page, `window.__HAI_SESSION__` (the session token), storage or cookies. Without `allow-forms`, `allow-popups`, `allow-modals` and `allow-top-navigation` it cannot post a form, open a window, show a dialog or navigate the app.
- **No network.** Its policy is `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; frame-src 'none'`, set both as the frame's `csp` attribute and as the first element of its document. It cannot fetch, open a socket or an event stream, send a beacon, load an image, script or frame from outside itself, or reach the bridge. The bridge would also refuse it: the frame's origin is `null`, which is not on the allow-list, and it has no token.
- **It cannot send itself elsewhere.** The app's own policy (`frame-src about:`) lets a frame hold only its own document, and the app ends a panel whose frame loads a second time.
- **One way out.** After the frame loads, the app gives it a single message port. Everything the panel sends is checked against the protocol's schemas: it can read the scene and send scene operations, nothing else, and an invalid operation changes nothing. At most 60 messages per second are accepted, a document is limited to 256 KB, and it cannot call the agent's tools.
- **An information panel cannot change the model.** Every agent can offer a panel, but one opened by an agent that does not change the model (Mochi, Climate, Reviewer) is marked by the bridge, never by the agent: the page refuses to preview or commit a change from it, tells the panel script, tells the agent when the panel closes, and shows Close only, with no Done.
- **The panel's controls are not its own.** Done and Close are outside the frame, so the document cannot hide, move or imitate them. An offer to open a panel is answered by you (a nod, a click), and one accepted offer allows exactly one panel.
- **What it cannot stop.** A panel runs its own script in its own process, so it can use that process's CPU and memory while it is open; the app ends a document that never finishes loading (after 8 seconds) and you can close any panel at once. A panel can show you anything it likes inside its own frame, so read what it asks you to do. A preview is shown only to you, and nothing is saved until you press Done or the panel's own commit.

The tests that keep these limits true are in `e2e/panel-sandbox.spec.ts` (a hostile panel tries each of the reads, requests and navigations above and none succeeds), `e2e/panel.spec.ts` (the frame controls) and the schema and host unit tests in `packages/protocol` and `apps/web/src/panel`.

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's private vulnerability reporting on this repository (Security tab, "Report a vulnerability"). Include steps to reproduce and the HAI commit you tested. You will get an acknowledgement within 7 days.

## Supported versions

Only the latest commit on `main` is supported until the first tagged release.
