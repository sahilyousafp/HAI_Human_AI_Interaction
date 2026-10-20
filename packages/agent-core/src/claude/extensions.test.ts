import { describe, expect, it } from "vitest";
import { mcpAddArgs, mcpRemoveArgs } from "./extensions.ts";
import { ClaudeCliProvider } from "./provider.ts";
import type { RunResult } from "./run.ts";

describe("claude mcp arguments", () => {
  it("stdio: name before the variadic --env, then -- so the command's own flags pass through", () => {
    expect(
      mcpAddArgs({
        transport: "stdio",
        name: "files",
        command: "npx",
        args: ["-y", "files-mcp", "--root", "."],
        env: { API_KEY: "s3cret" },
      }),
    ).toEqual([
      "mcp",
      "add",
      "--scope",
      "project",
      "--transport",
      "stdio",
      "files",
      "--env",
      "API_KEY=s3cret",
      "--",
      "npx",
      "-y",
      "files-mcp",
      "--root",
      ".",
    ]);
  });

  it("http: URL and one --header per header", () => {
    expect(
      mcpAddArgs({
        transport: "http",
        name: "tracker",
        url: "https://mcp.example.com/mcp",
        headers: { Authorization: "Bearer abc" },
      }),
    ).toEqual([
      "mcp",
      "add",
      "--scope",
      "project",
      "--transport",
      "http",
      "tracker",
      "https://mcp.example.com/mcp",
      "--header",
      "Authorization: Bearer abc",
    ]);
  });

  it("remove is project-scoped", () => {
    expect(mcpRemoveArgs("files")).toEqual(["mcp", "remove", "--scope", "project", "files"]);
  });
});

describe("ClaudeCliProvider extensions", () => {
  const provider = (result: RunResult, calls: Array<{ args: string[]; cwd?: string }> = []) =>
    new ClaudeCliProvider({
      executable: "claude",
      run: async (_command, args, options) => {
        calls.push({ args, cwd: options?.cwd });
        return result;
      },
    });

  it("runs the command in the project folder", async () => {
    const calls: Array<{ args: string[]; cwd?: string }> = [];
    await provider({ code: 0, stdout: "Added", stderr: "" }, calls).extensions.removeServer("D:/p", "files");
    expect(calls).toEqual([{ args: mcpRemoveArgs("files"), cwd: "D:/p" }]);
  });

  it("rejects with the CLI's message, with secret values masked", async () => {
    const failing = provider({ code: 1, stdout: "", stderr: "Invalid header value: Bearer abc\nmore" });
    await expect(
      failing.extensions.addServer("D:/p", {
        transport: "http",
        name: "tracker",
        url: "https://mcp.example.com/mcp",
        headers: { Authorization: "Bearer abc" },
      }),
    ).rejects.toThrow("Invalid header value: ••••");
  });
});
