import { ClaudeCliProvider } from "@hai/agent-core";
import { runBridge } from "./run.ts";

// The user's own Claude Code: the installed, self-logged-in CLI, started unmodified.
await runBridge(new ClaudeCliProvider());
