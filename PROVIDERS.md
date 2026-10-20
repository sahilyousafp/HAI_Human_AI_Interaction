# LLM providers

AEX does not ship, host or resell any AI model. It changes how **you** interact with an AI agent that you already have.

## Claude (current)

- AEX starts the `claude` command-line tool (Claude Code) that **you** installed and signed in to yourself, on your own machine.
- AEX runs the unmodified program and talks to it over its standard input and output, the same way a terminal would.
- AEX **never** reads, copies, stores, logs or forwards your Claude credentials, OAuth tokens or API keys. It never modifies the `claude` program or its requests.
- Usage counts against your own Claude plan or API account, under Anthropic's terms. One person, one install, one login.
- Your own Claude Code setup keeps working: your MCP servers, skills and settings load as usual, and AEX adds its scene tools on top.
- The agent team (Mochi and its specialists) is several sessions of the same `claude` program, one per agent, started with Claude Code's own `--agent` option and the agent files in the project's `.claude/agents`. Up to four can work at once (Mochi and three specialists), all on your plan; see [docs/agents.md](docs/agents.md).
- Tool calls your Claude Code settings would ask you about appear as approval cards in AEX (allow by click or nod, deny by click or shake, denied after 60 seconds). Nothing is silently allowed or silently denied.
- MCP servers you add in AEX go into the project's `.mcp.json` through `claude mcp add --scope project`, so they work in Claude Code too. Skills go into the project's `.claude/skills`.

How the session is started (the exact flags), what files AEX writes, approvals and extensions are described in [docs/agent.md](docs/agent.md).

If you share AEX with someone, they install and sign in to their own Claude Code. AEX must not be turned into a hosted service that runs other people's requests through one person's plan.

## Planned

The agent sits behind a provider interface so other agents can be added without changing the rest of the app:

| Provider | Route | Status |
|---|---|---|
| OpenAI Codex | Your own Codex CLI signed in with your ChatGPT plan | Planned |
| Local models | Ollama or LM Studio on your machine | Planned |
| API keys | Your own Anthropic or OpenAI-compatible key | Planned |

Each provider follows the same rule: your account, your machine, credentials handled only by the provider's own tools.

AEX is not affiliated with Anthropic, OpenAI or any model provider.
