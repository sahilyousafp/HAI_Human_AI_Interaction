import type { AgentEvent, AgentMcpServer } from "@aex/protocol";

/** How long a tool result summary may be in an event (the full result stays with the agent). */
export const SUMMARY_MAX = 400;

type Raw = Record<string, unknown>;
type ContentBlock = { type?: string; id?: string; name?: string; input?: unknown; text?: string } & Raw;

const SCOPES: Record<string, AgentMcpServer["scope"]> = {
  user: "user",
  project: "project",
  local: "local",
  plugin: "plugin",
  claudeai: "claude.ai",
  // Servers passed with --mcp-config, which is how the app adds its own scene tools.
  dynamic: "session",
};

/** "mcp__github__create_issue" comes from the "github" server; built-in tools have none. */
export function mcpServerOf(toolName: string): string | undefined {
  return toolName.match(/^mcp__(.+?)__/)?.[1];
}

function summarise(content: unknown): string {
  let text: string;
  if (typeof content === "string") text = content;
  else if (Array.isArray(content)) {
    text = content
      .map((part: ContentBlock) => (part.type === "text" ? (part.text ?? "") : `[${part.type ?? "content"}]`))
      .join(" ");
  } else text = JSON.stringify(content ?? "");
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > SUMMARY_MAX ? `${flat.slice(0, SUMMARY_MAX - 1)}…` : flat;
}

/**
 * Maps Claude Code's stream-json output (one parsed line at a time) to provider-neutral agent events.
 * Stateful only to report each tool call once. Everything not listed (hooks, status, rate limits, message
 * framing) maps to nothing.
 *
 * - system/init: the session's tools, MCP servers (with status and where they come from) and skills
 * - stream_event text_delta: reply text as it is written
 * - assistant tool_use: a tool call starting; user tool_result: its result
 * - result: the end of the turn, with usage
 */
export function createClaudeMapper(): (raw: Raw) => AgentEvent[] {
  const startedTools = new Set<string>();
  return (raw) => {
    switch (raw.type) {
      case "system":
        if (raw.subtype !== "init") return [];
        return [
          {
            type: "init",
            sessionId: String(raw.session_id ?? ""),
            ...(typeof raw.model === "string" ? { model: raw.model } : {}),
            ...(typeof raw.claude_code_version === "string" ? { version: raw.claude_code_version } : {}),
            tools: Array.isArray(raw.tools) ? raw.tools.map(String) : [],
            mcpServers: (Array.isArray(raw.mcp_servers) ? raw.mcp_servers : []).map((s: Raw) => ({
              name: String(s.name ?? ""),
              status: String(s.status ?? "unknown"),
              scope: SCOPES[String(s.source ?? s.scope ?? "")] ?? "unknown",
              ...(typeof s.error === "string" ? { error: s.error } : {}),
            })),
            skills: (Array.isArray(raw.skills) ? raw.skills : []).map((s: unknown) =>
              typeof s === "string"
                ? { name: s, scope: "unknown" as const }
                : { name: String((s as Raw).name ?? ""), scope: "unknown" as const },
            ),
          },
        ];
      case "stream_event": {
        const event = raw.event as Raw | undefined;
        const delta = event?.delta as Raw | undefined;
        if (
          event?.type === "content_block_delta" &&
          delta?.type === "text_delta" &&
          typeof delta.text === "string"
        ) {
          return [{ type: "text.delta", text: delta.text }];
        }
        return [];
      }
      case "assistant": {
        const content = ((raw.message as Raw | undefined)?.content ?? []) as ContentBlock[];
        const events: AgentEvent[] = [];
        for (const block of content) {
          if (block.type !== "tool_use" || !block.id || startedTools.has(block.id)) continue;
          startedTools.add(block.id);
          const name = String(block.name ?? "");
          const server = mcpServerOf(name);
          events.push({
            type: "tool.start",
            id: block.id,
            name,
            ...(server ? { server } : {}),
            input: block.input,
          });
        }
        return events;
      }
      case "user": {
        const content = (raw.message as Raw | undefined)?.content;
        if (!Array.isArray(content)) return [];
        return content
          .filter((block: Raw) => block.type === "tool_result" && typeof block.tool_use_id === "string")
          .map((block: Raw) => ({
            type: "tool.end" as const,
            id: block.tool_use_id as string,
            outcome: block.is_error === true ? ("failed" as const) : ("done" as const),
            summary: summarise(block.content),
          }));
      }
      case "result": {
        const usage = raw.usage as Raw | undefined;
        const n = (key: string) => (typeof usage?.[key] === "number" ? (usage[key] as number) : 0);
        const ok = raw.subtype === "success" && raw.is_error !== true;
        const events: AgentEvent[] = [];
        if (!ok && typeof raw.result === "string" && raw.result)
          events.push({ type: "error", message: raw.result });
        events.push({
          type: "turn.end",
          reason: ok ? "done" : "error",
          ...(usage
            ? {
                usage: {
                  inputTokens:
                    n("input_tokens") + n("cache_creation_input_tokens") + n("cache_read_input_tokens"),
                  outputTokens: n("output_tokens"),
                },
              }
            : {}),
          ...(typeof raw.duration_ms === "number" ? { durationMs: raw.duration_ms } : {}),
        });
        return events;
      }
      default:
        return [];
    }
  };
}

/** Splits a byte stream into complete lines; a partial line waits for the rest. */
export function createLineSplitter(onLine: (line: string) => void): (chunk: string) => void {
  let buffer = "";
  return (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) onLine(line);
      newline = buffer.indexOf("\n");
    }
  };
}
