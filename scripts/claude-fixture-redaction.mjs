// Makes recorded Claude Code stream-json safe to commit: it keeps the shape of every event but removes anything
// that identifies the user or their setup. Used by record-claude-fixtures.mjs.
import { homedir, userInfo } from "node:os";

/** Our own test servers keep their names; everything the user has configured is renamed. */
const KEEP_SERVERS = new Set(["aex", "broken-server"]);

function scrubText(text, project) {
  let out = text;
  const replace = (value, by) => {
    if (!value) return;
    for (const v of new Set([value, value.replaceAll("\\", "\\\\"), value.replaceAll("\\", "/")])) {
      out = out.split(v).join(by);
    }
  };
  replace(project, "<project>");
  replace(homedir(), "<home>");
  replace(userInfo().username, "<user>");
  return out
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>")
    .replace(
      /"(org(?:anization)?_?(?:id|uuid|name)|account_?(?:id|uuid|name)|email)":\s*"[^"]*"/gi,
      '"$1":"<redacted>"',
    );
}

/** Renames the user's MCP servers consistently across tool names and the server list. */
function serverRenamer() {
  const names = new Map();
  return (name) => {
    if (KEEP_SERVERS.has(name)) return name;
    if (!names.has(name)) names.set(name, `user-server-${names.size + 1}`);
    return names.get(name);
  };
}

function anonymiseInit(event, rename) {
  const builtIn = event.tools.filter((t) => !t.startsWith("mcp__"));
  const mcpTools = event.tools
    .filter((t) => t.startsWith("mcp__"))
    .map((t) => {
      const [, server = "", tool = ""] = t.match(/^mcp__(.+?)__(.+)$/) ?? [];
      return KEEP_SERVERS.has(server) ? t : `mcp__${rename(server)}__${tool ? "example_tool" : "tool"}`;
    });
  return {
    ...event,
    tools: [...builtIn, ...new Set(mcpTools)],
    mcp_servers: event.mcp_servers.map((s) => ({ ...s, name: rename(s.name) })),
    slash_commands: ["compact", "example-skill"],
    skills: ["example-skill"],
    agents: ["claude"],
    plugins: [
      {
        name: "example-plugin",
        path: "<home>/.claude/plugins/example-plugin",
        source: "example-plugin@marketplace",
      },
    ],
  };
}

/** Returns a function that anonymises one stream-json line (a string) from a recording made in `project`. */
export function createAnonymiser(project) {
  const rename = serverRenamer();
  return (line) => {
    let event = JSON.parse(line);
    if (event.type === "system" && event.subtype === "init") event = anonymiseInit(event, rename);
    if (event.type === "system" && String(event.subtype).startsWith("hook_")) {
      // The user's own hooks print whatever they print; keep only the shape.
      for (const key of ["output", "stdout", "stderr", "content", "response", "hook_name", "command"]) {
        if (key in event) event[key] = "<hook output>";
      }
    }
    return scrubText(JSON.stringify(event), project);
  };
}
