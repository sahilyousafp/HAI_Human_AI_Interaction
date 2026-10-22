import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Recorded from the real Claude Code CLI by scripts/record-claude-fixtures.mjs and anonymised as they were written.
const dir = join(import.meta.dirname, "..", "..", "fixtures");
const fixtures = readdirSync(dir).filter((f) => f.endsWith(".ndjson"));
const read = (name: string) => readFileSync(join(dir, name), "utf8");
const events = (name: string) =>
  read(name)
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as Record<string, unknown>);

describe("recorded Claude Code fixtures", () => {
  it("exist", () => {
    expect(fixtures).toContain("two-turns.ndjson");
  });

  describe.each(fixtures)("%s holds nothing that identifies the user or their setup", (name) => {
    const text = read(name);

    it("no email addresses", () => {
      expect(text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []).toEqual([]);
    });

    it("no real home folders or user names in paths", () => {
      expect(text.match(/[A-Za-z]:(\\\\|\/)Users(\\\\|\/)(?!<user>)[^\\/"]+/gi) ?? []).toEqual([]);
      expect(text.match(/\/(home|Users)\/(?!<user>)[^/"]+/g) ?? []).toEqual([]);
    });

    it("no account details", () => {
      expect(text).not.toMatch(
        /"(email|orgName|orgId|organization_?name|account_?(name|uuid))":"(?!<redacted>)/i,
      );
    });

    it("only placeholder names for the user's own MCP servers", () => {
      for (const e of events(name)) {
        if (e.type !== "system" || e.subtype !== "init") continue;
        for (const server of e.mcp_servers as Array<{ name: string }>) {
          expect(server.name).toMatch(/^(hai|broken-server|user-server-\d+)$/);
        }
      }
    });

    it("no output from the user's hooks", () => {
      for (const e of events(name)) {
        if (e.type !== "system" || !String(e.subtype).startsWith("hook_")) continue;
        for (const key of ["output", "stdout", "stderr", "content", "response", "hook_name", "command"]) {
          if (key in e) expect(e[key]).toBe("<hook output>");
        }
      }
    });
  });

  it("two-turns covers what the mapping needs: init, streamed text, a tool call and its result, two results", () => {
    const list = events("two-turns.ndjson");
    const kinds = new Set(
      list.map((e) => `${e.type}:${String(e.subtype ?? (e.event as { type?: string })?.type ?? "")}`),
    );
    expect(kinds).toContain("system:init");
    expect(kinds).toContain("stream_event:content_block_delta");
    const toolUse = list.some(
      (e) => e.type === "assistant" && JSON.stringify(e.message).includes('"type":"tool_use"'),
    );
    const toolResult = list.some(
      (e) => e.type === "user" && JSON.stringify(e.message).includes('"type":"tool_result"'),
    );
    expect(toolUse).toBe(true);
    expect(toolResult).toBe(true);
    expect(list.filter((e) => e.type === "result")).toHaveLength(2);
  });
});
