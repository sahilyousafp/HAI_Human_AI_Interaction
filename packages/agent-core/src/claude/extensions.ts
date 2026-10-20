import type { McpServerSpec } from "@aex/protocol";

/**
 * `claude mcp add` arguments for a project-scoped server. The name comes before the variadic `--env` and `--header`
 * options, and `--` ends the options, so a stdio command's own flags are passed through untouched.
 */
export function mcpAddArgs(server: McpServerSpec): string[] {
  if (server.transport === "http") {
    const headers = Object.entries(server.headers).flatMap(([key, value]) => [
      "--header",
      `${key}: ${value}`,
    ]);
    return ["mcp", "add", "--scope", "project", "--transport", "http", server.name, server.url, ...headers];
  }
  const env = Object.entries(server.env).flatMap(([key, value]) => ["--env", `${key}=${value}`]);
  return [
    "mcp",
    "add",
    "--scope",
    "project",
    "--transport",
    "stdio",
    server.name,
    ...env,
    "--",
    server.command,
    ...server.args,
  ];
}

export function mcpRemoveArgs(name: string): string[] {
  return ["mcp", "remove", "--scope", "project", name];
}
