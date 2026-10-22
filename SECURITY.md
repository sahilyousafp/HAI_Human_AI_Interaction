# Security

HAI drives an AI agent on your machine, so its local surface is treated as security-sensitive.

## How HAI protects your machine

- **Loopback only.** The bridge listens on `127.0.0.1` and refuses to start on any other address. No other device on your network can reach it.
- **Session token.** Each bridge start creates a random 32-byte token. A WebSocket connection must present it, and tokens are compared in constant time.
- **Origin allow-list.** Connections must come from the HAI web app's own origin. A random website open in another tab cannot connect, even if it guesses the port.
- **Token stays local.** The token is written to `.hai/session.json` (git-ignored) and injected into the dev page. The dev server sends no CORS headers, so other origins cannot read the page.
- **Camera frames stay on device.** Video is processed inside a browser worker. Only hand and face landmarks leave it. Nothing is recorded or uploaded.
- **Your agent credentials are never touched.** See [PROVIDERS.md](PROVIDERS.md).

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's private vulnerability reporting on this repository (Security tab, "Report a vulnerability"). Include steps to reproduce and the HAI commit you tested. You will get an acknowledgement within 7 days.

## Supported versions

Only the latest commit on `main` is supported until the first tagged release.
