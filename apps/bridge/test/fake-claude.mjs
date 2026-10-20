// A stand-in for `claude -p` in stream-json mode, for tests: it speaks the same protocol as the recorded real CLI
// (packages/agent-core/fixtures) and remembers each conversation by session id in FAKE_CLAUDE_STATE, so --resume
// continues it. Requests are scripted by their text:
//   "crash"      exits mid-turn, as if the process were killed
//   "slow"       streams text for 20 s (to test stopping)
//   "stubborn"   like slow, but ignores the interrupt request (to test the kill-and-resume fallback)
//   "shell: X"   runs the shell command X as a Bash tool call, asking the permission prompt tool first
//   "column"     creates a column with the app's create_elements tool, asking the permission prompt tool first
//   "bad column" the same with a zero height, so the scene tool fails validation
//   "stream"     a reply in five pieces, 150 ms apart (to watch it stream)
//   anything     replies "pid=<pid> turn=<n> previous=<the previous request>" in three pieces
// `mcp add|remove --scope project` edit .mcp.json in the project folder in Claude Code's format, and the init event
// lists those servers (one named "broken..." as failed) and the skills in .claude/skills, as the real CLI does.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const mcpFile = join(process.cwd(), ".mcp.json");
const skillsDir = join(process.cwd(), ".claude", "skills");
const readMcp = () => (existsSync(mcpFile) ? JSON.parse(readFileSync(mcpFile, "utf8")) : { mcpServers: {} });

if (args[0] === "mcp") {
  const config = readMcp();
  if (args[1] === "remove") {
    const name = args.at(-1);
    if (!config.mcpServers[name]) {
      process.stderr.write(`No project-scoped MCP server found with name: ${name}\n`);
      process.exit(1);
    }
    delete config.mcpServers[name];
  } else {
    const transport = flag("--transport") ?? "stdio";
    const end = args.indexOf("--");
    const rest = args.slice(args.indexOf(transport) + 1, end >= 0 ? end : undefined);
    const name = rest[0];
    const pairs = (option, separator) =>
      Object.fromEntries(
        rest.flatMap((a, i) =>
          rest[i - 1] === option
            ? [[a.split(separator)[0], a.split(separator).slice(1).join(separator).trim()]]
            : [],
        ),
      );
    if (config.mcpServers[name]) {
      process.stderr.write(`MCP server ${name} already exists in project config\n`);
      process.exit(1);
    }
    config.mcpServers[name] =
      transport === "http"
        ? { type: "http", url: rest[1], headers: pairs("--header", ":") }
        : { type: "stdio", command: args[end + 1], args: args.slice(end + 2), env: pairs("--env", "=") };
  }
  writeFileSync(mcpFile, `${JSON.stringify(config, null, 2)}\n`);
  process.exit(0);
}

const stateDir = process.env.FAKE_CLAUDE_STATE ?? join(process.cwd(), ".fake-claude");
mkdirSync(stateDir, { recursive: true });
const sessionId = flag("--resume") ?? randomUUID();
const historyFile = join(stateDir, `${sessionId}.json`);
const history = existsSync(historyFile) ? JSON.parse(readFileSync(historyFile, "utf8")) : [];
// Every start is recorded, so tests can tell a reused process from a new one and see the flags.
writeFileSync(
  join(stateDir, `start-${process.pid}.json`),
  JSON.stringify({ pid: process.pid, args, cwd: process.cwd() }),
);

const emit = (event) => process.stdout.write(`${JSON.stringify({ ...event, session_id: sessionId })}\n`);

/** Calls a tool on the app's MCP server from --mcp-config, as Claude Code would (JSON-RPC over HTTP). */
async function callAppTool(name, args) {
  const config = JSON.parse(readFileSync(flag("--mcp-config"), "utf8")).mcpServers.aex;
  const res = await fetch(config.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...config.headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const body = await res.text();
  // Streamable HTTP may answer as an event stream: the JSON-RPC response is the last data line.
  const lines = body.split(/\r?\n/).filter((l) => l.startsWith("data:"));
  return JSON.parse(lines.length > 0 ? lines.at(-1).slice(5) : body).result;
}

/** Claude Code's permission check: asks --permission-prompt-tool and returns its allow / deny decision. */
async function askPermission(tool, input, toolUseId) {
  const prompt = flag("--permission-prompt-tool").replace(/^mcp__aex__/, "");
  const result = await callAppTool(prompt, { tool_name: tool, input, tool_use_id: toolUseId });
  return JSON.parse(result.content[0].text);
}

/**
 * One tool call as the real CLI streams it: the tool_use block, then (after the permission check) its result.
 * `run` returns the output text, or `{ error }` when the tool failed.
 */
async function toolCall(tool, input, run) {
  const id = `toolu_${randomUUID().slice(0, 8)}`;
  emit({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "tool_use", id, name: tool, input }] },
  });
  const decision = await askPermission(tool, input, id);
  const allowed = decision.behavior === "allow";
  const ran = allowed ? await run(decision.updatedInput) : { error: decision.message };
  const output = typeof ran === "string" ? ran : ran.error;
  emit({
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: id, content: output, is_error: typeof ran !== "string" }],
    },
  });
  return { allowed, output };
}

let slowTimer = null;
let stubborn = false;

function init() {
  emit({
    type: "system",
    subtype: "init",
    cwd: process.cwd(),
    tools: ["Read", "Bash", "mcp__aex__get_scene_summary"],
    mcp_servers: [
      { name: "aex", status: "connected", source: "dynamic" },
      ...Object.keys(readMcp().mcpServers).map((name) => ({
        name,
        status: name.startsWith("broken") ? "failed" : "connected",
        source: "project",
      })),
    ],
    skills: existsSync(skillsDir) ? readdirSync(skillsDir) : [],
    claude_code_version: "2.1.303-fake",
  });
}

const delta = (text) =>
  emit({
    type: "stream_event",
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
  });
const result = (subtype = "success") =>
  emit({
    type: "result",
    subtype,
    is_error: subtype !== "success",
    duration_ms: 5,
    usage: { input_tokens: 3, output_tokens: 7 },
    ...(subtype === "success" ? {} : { terminal_reason: "aborted_streaming" }),
  });

function onRequest(text) {
  init();
  if (text === "crash") process.exit(3);
  history.push(text);
  writeFileSync(historyFile, JSON.stringify(history));
  if (text.startsWith("shell: ")) {
    const command = text.slice("shell: ".length);
    toolCall("Bash", { command, description: "Run a command" }, async () => `ran: ${command}`).then(
      ({ allowed, output }) => {
        delta(allowed ? `Done: ${output}` : `I did not run it: ${output}`);
        result();
      },
    );
    return;
  }
  if (text === "column" || text === "bad column") {
    const tool = "mcp__aex__create_elements";
    const element = {
      type: "column",
      name: "Fake column",
      position: [0, -8000],
      section: [400, 400],
      height: text === "column" ? 3000 : 0,
    };
    toolCall(tool, { elements: [element] }, async (input) => {
      const created = await callAppTool("create_elements", input);
      const output = created.content[0].text;
      return created.isError ? { error: output } : output;
    }).then(({ output }) => {
      delta(text === "column" ? "Added a column." : `That failed: ${output}`);
      result();
    });
    return;
  }
  if (text === "stream") {
    const pieces = ["Three ", "floors ", "of ", "3.5 m ", "added."];
    for (const [i, piece] of pieces.entries()) {
      setTimeout(
        () => {
          delta(piece);
          if (i === pieces.length - 1) result();
        },
        150 * (i + 1),
      );
    }
    return;
  }
  if (text === "slow" || text === "stubborn") {
    stubborn = text === "stubborn";
    let n = 0;
    slowTimer = setInterval(() => {
      n += 1;
      delta(`${n} `);
      if (n >= 100) {
        clearInterval(slowTimer);
        slowTimer = null;
        result();
      }
    }, 200);
    return;
  }
  const reply = `pid=${process.pid} turn=${history.length} previous=${history.at(-2) ?? "none"}`;
  for (const piece of [reply.slice(0, 8), reply.slice(8, 20), reply.slice(20)]) delta(piece);
  result();
}

let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  let i = buffer.indexOf("\n");
  while (i >= 0) {
    const line = buffer.slice(0, i).trim();
    buffer = buffer.slice(i + 1);
    i = buffer.indexOf("\n");
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.type === "control_request" && message.request?.subtype === "interrupt") {
      emit({ type: "control_response", response: { subtype: "success", request_id: message.request_id } });
      if (slowTimer && !stubborn) {
        clearInterval(slowTimer);
        slowTimer = null;
        result("error_during_execution");
      }
    } else if (message.type === "user") {
      onRequest(String(message.message?.content ?? ""));
    }
  }
});
process.stdin.on("end", () => process.exit(0));
