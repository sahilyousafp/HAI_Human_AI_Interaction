# Demo 01 - "Why I'm not building a Rhino plugin"

Week 1 clip. Target length 45-60 s, 4:5 or 16:9, captions burned in.

## Setup (before recording)

1. Close everything except Edge and a terminal. Hide desktop icons and notifications (Windows Focus on).
2. Open the decision page: https://claude.ai/artifact/Je3MMdhnomu7ED69JhAgN7 (set it to dark theme).
3. In a terminal at the repo root: `pnpm install`. Do not start `pnpm dev` yet.
4. Open the GitHub repository's Actions tab with a green CI run (once the repo is public).
5. Start the recorder (OBS or Cap) at 1080p, 30 fps.

## Shot list

| # | Time | On screen | Voice-over / caption |
|---|---|---|---|
| 1 | 0-3 s | Decision page hero: "Build the hands, not the modeler." | "I'm teaching my Rhino model to read my hands." |
| 2 | 3-12 s | Scroll to the decision matrix. Click the preset "Just a personal tool": Rhino plugin wins. Click "Your profile": Hybrid wins. | "A Rhino plugin wins if it's just for me. For everyone else, a hybrid wins." |
| 3 | 12-22 s | Architecture diagram, Hybrid tab. Hover the dashed teal lines. | "My own interaction layer in the browser. Rhino does the precise geometry through MCP. Gestures never wait for the AI." |
| 4 | 22-32 s | Terminal: `pnpm dev`. Browser: http://127.0.0.1:5173 goes from Connecting to Connected. | "Week 1: the workspace. A local bridge that only listens on this machine, with a session token." |
| 5 | 32-40 s | Stop `pnpm dev` (Ctrl+C): header turns to "Bridge offline". Restart: back to Connected. | "If the bridge goes away, the app knows. If it comes back, it reconnects." |
| 6 | 40-50 s | CI run: green on Windows and Ubuntu. | "Tests, lint and a license check on every push. No GPL, nothing non-commercial." |
| 7 | 50-55 s | Roadmap table in the README. | "Next week: hand and face tracking, on the laptop, nothing uploaded." |

## Expected result

- Header pill: Connecting, then Connected within 2 s of the page loading.
- After Ctrl+C: Bridge offline within 1 s, both processes gone (`netstat -ano | findstr 4870` and `5173` show nothing).
- After restart and page reload: Connected again.

## Check after recording

- Captions readable on a phone.
- No session token visible on screen (do not open `.hai/session.json` or DevTools in this clip).
