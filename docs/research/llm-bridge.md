# LLM bridge on subscription plans, app shell, OSS setup

Research date: 2026-10-19. Not legal advice.

**Headline:** spawning the `claude` binary that the user installed and logged into themselves is the allowed carve-out. Handling Claude.ai credentials inside our code is not allowed. OpenAI "Sign in with ChatGPT" is now the only official path for OSS apps to bill a user's subscription. Gemini CLI dropped personal accounts on 2026-06-18.

## 1. Claude Code headless, Agent SDK, policy

Flags ([docs](https://code.claude.com/docs/en/headless)):

| Need | Flag |
|---|---|
| Non-interactive | `-p` / `--print` |
| Output | `--output-format text\|json\|stream-json` (+ `--verbose --include-partial-messages`). Final `result` event has `session_id`, `total_cost_usd` |
| Structured result | `--json-schema '<schema>'` |
| Long-lived process | `--input-format stream-json` (JSON lines on stdin) |
| Sessions | `--continue`, `--resume <id or .jsonl>` |
| Tools / permissions | `--allowedTools "Read,mcp__rhino__*"`, `--permission-mode auto\|dontAsk\|acceptEdits`, `--permission-prompts none`, `--permission-prompt-tool` |
| Context | `--append-system-prompt[-file]`, `--system-prompt`, `--mcp-config`, `--model`, `--settings`, `--agents` |
| Fast start | `--bare` ignores subscription login and only works with an API key. Docs say it "will become the default for `-p` in a future release" |

- Cold start: without `--bare`, `-p` loads hooks, skills, plugins, CLAUDE.md, `.mcp.json` and waits up to `MCP_TIMEOUT` (30 s) for MCP servers. Keep one process per conversation alive with `--input-format stream-json`, and run from an empty dedicated cwd.
- Agent SDK (`@anthropic-ai/claude-agent-sdk`, `claude-agent-sdk`): runs the Claude Code binary, adds `canUseTool`, sessions, hooks, in-process MCP. Governed by Commercial Terms.

Policy quotes ([legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)):
- "OAuth authentication is intended exclusively for purchasers of Claude Free, Pro, Max, Team, and Enterprise subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications."
- "Developers building products or services ... including those using the Agent SDK, should use API key authentication ... Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users. Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens."
- Carve-out: does not "prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription." Enforcement "may [happen] without prior notice."
- Consumer Terms: no automated access "except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it."
- Help Center (2026-10-07): "Claude Agent SDK, claude -p, and third-party app usage still draw from your subscription limits."

Timeline (mostly secondary sources): Jan 2026 spoofed-header tokens blocked; Feb 2026 "Authentication and credential use" section added, OpenCode removed Claude OAuth; Apr/May reported revocation then reversal with planned Agent SDK credit; Jun 15 change paused.

**Max/Team monthly API credits (Oct 2026):** Max 5x $100/mo, Max 20x $200/mo, Team up to $500 pooled. Pro not eligible. Link a Console org, create a normal API key. Covers API + Agent SDK, docs say not "Claude Code" (unclear for `-p`). [Source](https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers).

Risk tiers:
- **Lowest:** user installs and logs in to Claude Code themselves; app spawns the unmodified binary; never reads `~/.claude/.credentials.json`, never mints tokens, never spoofs headers.
- **Grey:** "route requests on behalf of users" arguably still covers a CLI-driving app; "ordinary individual usage" for a gesture agent is unclear. Default to user's API key / Max credits; label local Claude Code login "experimental, at your own risk".
- **Not allowed:** "Sign in with Claude" button, embedding/proxying tokens, "Claude Code" in product name ("Powered by Claude" is fine).

Limits: rolling 5-hour window + weekly cap; Max = 5x / 20x Pro.

## 2. Other subscription-capable CLIs

| CLI | Headless / JSON | Subscription status (Oct 2026) |
|---|---|---|
| **OpenAI Codex** | `codex exec --json`, `--output-schema`, `exec resume`, `--sandbox`, `--approve-for-me`. app-server JSON-RPC over stdio (`thread/start`, `turn/start`, deltas, approvals, MCP). [docs](https://learn.chatgpt.com/docs/app-server) | **Best supported.** ChatGPT-plan sign-in official. **Sign in with ChatGPT** (preview, 2026-09-29): PKCE, loopback redirect, scope `chatgpt.tokens.use.direct`, Responses API only. OSS partners: OpenCode, Pi, OpenClaw, T3. [docs](https://developers.openai.com/siwc/token-sharing-open-source/sign-in) |
| **Gemini CLI** | `-p`, `--output-format json\|stream-json`, `--resume`, `--acp` | Personal accounts dropped 2026-06-18; API keys / enterprise only. [blog](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/) |
| Antigravity CLI | `-p`, JSON | Closed source, reported hang when not a TTY |
| GitHub Copilot CLI | `copilot -p`, `--allow-tool`, `--no-ask-user`; ACP preview | Copilot plan; premium-request billing unverified |
| Cursor CLI | `agent -p --output-format stream-json`; ACP | Billing for headless unclear |
| Qwen Code | headless; ACP | Free OAuth ended 2026-04-15 |
| OpenCode | `opencode run --format json`, `opencode serve`; ACP | ChatGPT plan via SIWC |
| Amp | `amp --execute --stream-json` | Paid credits |

## 3. Protocols and adapter design

- **ACP** (JSON-RPC stdio): native Gemini CLI, Copilot, Cursor, OpenCode, Qwen, Goose, Kiro, Cline, Junie; adapters for Claude (`@agentclientprotocol/claude-agent-acp`) and Codex (`codex-acp`). [agents list](https://agentclientprotocol.com/get-started/agents)
- **MCP** is the decoupling layer: expose the scene/Rhino as one MCP server (`create_box`, `select`, `set_view`, `get_scene_summary`); every CLI loads it.
- Vercel AI SDK community provider `ai-sdk-provider-claude-code`. LiteLLM / OpenRouter / Ollama / LM Studio = one OpenAI-compatible backend.

```ts
interface AgentProvider {
  id: string; kind: "cli" | "acp" | "api" | "local";
  detect(): Promise<{ installed: boolean; authed: boolean; billing: "subscription" | "api" | "local" | "unknown" }>;
  startSession(o: { cwd: string; mcpServers: McpCfg[]; systemPrompt: string; model?: string }): Promise<Session>;
}
interface Session {
  send(input: { text: string; images?: Blob[] }): AsyncIterable<AgentEvent>; // text_delta | tool_call | tool_result | permission_request | done | error
  respondPermission(id: string, allow: boolean): void;
  interrupt(): Promise<void>; close(): Promise<void>; resumeId?: string;
}
```

Backends: AcpProvider, ClaudeCliProvider (long-lived stream-json), CodexAppServerProvider, OpenAICompatProvider, AnthropicApiProvider, later SIWC provider.

## 4. App shell on Windows

| Option | Overlay | Camera | Spawn CLIs | Verdict |
|---|---|---|---|---|
| **Electron** | `setIgnoreMouseEvents(true, {forward:true})` keeps hover | getUserMedia, MediaPipe fine | Node child_process (mind `.cmd` shims) | Recommended v1 |
| Tauri 2 | `setIgnoreCursorEvents` without hover forwarding (#9250), Windows child-window bug (#11461) | WebView2 OK | Shell plugin / sidecar | Port later |
| PWA | None | Yes | Needs companion | Demo only |
| Rhino Eto WebView2 panel | Docked panel | Fiddly | .NET Process | Secondary inspector |

Bridge: RhinoCommon plugin hosts localhost WebSocket JSON-RPC; doc changes through `RhinoApp.InvokeOnUiThread`; localhost only + random per-session token.

Voice: Web Speech likely unreliable in Electron (unverified). Local: Silero VAD (`@ricky0123/vad-web`) + Moonshine streaming (vendor claims 34-107 ms) or whisper.cpp / faster-whisper sidecar.

## 5. OSS setup

- **Apache-2.0** (patent grant, matches MediaPipe). Avoid Ultralytics (AGPL). Rhino plugin: reference RhinoCommon from NuGet, do not redistribute Rhino. Do not bundle Claude Code; detect user's install. No vendor names in project name.
- Monorepo: `apps/web`, `apps/bridge`, `apps/overlay`, `packages/{perception,agent-core,voice,protocol}`, `mcp/`, `plugins/rhino`, `docs/`, `demos/`.
- Demo-driven: each milestone = a 30-60 s clip with a repeatable `demos/` script. CONTRIBUTING, SECURITY (agents spawn processes), PROVIDERS.md (ToS status per provider).
- Recording on Windows: OBS, [Cap](https://github.com/CapSoftware/Cap) (AGPL, Screen Studio-like), ScreenToGif, Clipchamp for captions.
- LinkedIn (directional): native upload, 30-90 s, burned-in captions, 4:5 or 9:16, hook in first 2-3 s. Twice weekly: short demo clip + longer build log.

## Open questions

1. Does an OSS app spawning the user's own logged-in `claude -p` count as "routing on behalf of users"? Ask Anthropic in writing.
2. Does `claude -p` with an API key draw Max credits?
3. SIWC preview limits and stability.
4. Cursor / Copilot headless billing.
5. Electron Web Speech; Tauri hover forwarding.
