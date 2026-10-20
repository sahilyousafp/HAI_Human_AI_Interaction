// Records stream-json output of the installed Claude Code CLI into packages/agent-core/fixtures, so the event
// mapping is tested against what the real CLI emits. Uses the user's own logged-in CLI, unmodified, in a throwaway
// folder: two short turns (a read-only Glob tool call, then a follow-up) and a deliberately broken MCP server.
// Output is anonymised as it is written (claude-fixture-redaction.mjs): user paths and names, emails, account
// details, the user's own servers, skills and plugins, and hook output never reach disk.
//
//   node scripts/record-claude-fixtures.mjs
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAnonymiser } from "./claude-fixture-redaction.mjs";

const root = join(import.meta.dirname, "..");
// The same Windows-safe spawning the provider uses (a dependency of @aex/agent-core).
const spawn = createRequire(join(root, "packages", "agent-core", "package.json"))("cross-spawn");
const out = join(root, "packages", "agent-core", "fixtures");
mkdirSync(out, { recursive: true });

const project = mkdtempSync(join(tmpdir(), "aex-fixture-"));
writeFileSync(join(project, "notes.txt"), "plan\n");
writeFileSync(join(project, "brief.txt"), "brief\n");
const mcpConfig = join(project, "mcp.json");
writeFileSync(
  mcpConfig,
  JSON.stringify({ mcpServers: { "broken-server": { command: "aex-no-such-command", args: [] } } }),
);

const turns = [
  "Use the Glob tool to list the .txt files in the current folder, then reply with just the number of files.",
  "What number did you reply with? Answer with the number only.",
];

const anonymise = createAnonymiser(project);

const args = [
  "-p",
  "--input-format",
  "stream-json",
  "--output-format",
  "stream-json",
  "--verbose",
  "--include-partial-messages",
  "--mcp-config",
  mcpConfig,
];
const child = spawn("claude", args, { cwd: project, windowsHide: true });
const lines = [];
let buffer = "";
let turn = 0;

const send = (text) =>
  child.stdin.write(`${JSON.stringify({ type: "user", message: { role: "user", content: text } })}\n`);

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  let newline = buffer.indexOf("\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    newline = buffer.indexOf("\n");
    if (!line) continue;
    lines.push(anonymise(line));
    if (JSON.parse(line).type === "result") {
      turn += 1;
      if (turn < turns.length) send(turns[turn]);
      else child.stdin.end();
    }
  }
});
// stderr is not echoed: it can carry account or setup details. Only note that something was written.
child.stderr.once("data", () => console.error("(claude wrote to stderr; run it by hand to see why)"));
child.on("close", (code) => {
  writeFileSync(join(out, "two-turns.ndjson"), `${lines.join("\n")}\n`);
  const types = lines.map((l) => {
    const e = JSON.parse(l);
    return e.type === "stream_event"
      ? `stream_event:${e.event?.type}`
      : `${e.type}${e.subtype ? `:${e.subtype}` : ""}`;
  });
  console.log(`exit ${code}, ${lines.length} lines`);
  console.log([...new Set(types)].join("\n"));
});
send(turns[0]);
