// A stand-in for `claude -p` in stream-json mode, for tests: it speaks the same protocol as the recorded real CLI
// (packages/agent-core/fixtures) and remembers each conversation by session id in FAKE_CLAUDE_STATE, so --resume
// continues it. Requests are scripted by their text:
//   "crash"      exits mid-turn, as if the process were killed
//   "slow"       streams text for 20 s (to test stopping)
//   "stubborn"   like slow, but ignores the interrupt request (to test the kill-and-resume fallback)
//   "shell: X"   runs the shell command X as a Bash tool call, asking the permission prompt tool first
//   "column"     creates a column with the app's create_elements tool, asking the permission prompt tool first
//   "bad column" the same with a zero height, so the scene tool fails validation
//   "columns N"  creates N columns, one create_elements call each
//   "winter shadows" runs sun_study for 21 December, 12:00, in London (as Climate would)
//   "two sentences"  replies with one sentence, then a second 1.5 s later (to hear the first spoken early)
//   "stream"     a reply in five pieces, 150 ms apart (to watch it stream)
//   "work N"     streams for N ms, then replies "Finished work N" (stoppable, like slow)
//   anything     replies "agent=<--agent> pid=<pid> turn=<n> previous=<the previous request>" in three pieces
// As Mochi, the team lead, it uses the app's team tools the way the real model is told to:
//   "delegate A: X | B: Y"  hands task X to A and Y to B (delegate), then replies "Handed out: ..."
//   "ask A to X"            hands X to A
//   "[for: A]" first line   hands the rest of the request to A
//   "status"     calls team_status and replies "<agent>: <task title> (<state>)" for each busy agent, or "All idle."
//   "stop A"     cancels A's current task (team_status, then cancel_task)
//   "[team] ..." a report of finished tasks: replies "Report: " and the task lines
// A specialist's task arrives with a "[task] ..." first line, which is dropped before the scripts above apply.
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
  const reply = JSON.parse(lines.length > 0 ? lines.at(-1).slice(5) : body);
  // A protocol error (an unknown tool) reaches the model as a failed tool result, as in Claude Code.
  return reply.result ?? { content: [{ type: "text", text: reply.error.message }], isError: true };
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
  return { allowed, output, failed: typeof ran !== "string" };
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

/** Calls one of the app's tools as a tool call the user sees, and returns its parsed JSON output or { error }. */
async function appTool(name, input) {
  const { output } = await toolCall(`mcp__aex__${name}`, input, async (allowed) => {
    const called = await callAppTool(name, allowed);
    return called.isError ? { error: called.content[0].text } : called.content[0].text;
  });
  try {
    return JSON.parse(output);
  } catch {
    return { error: output };
  }
}

/** Mochi's scripted requests (see the top of this file); false for anything else. */
function asLead(text, forAgent) {
  const say = (reply) => {
    delta(reply);
    result();
  };
  if (text.startsWith("[team]")) {
    say(`Report: ${text.split("\n").slice(1).join(" ")}`);
    return true;
  }
  const askTo = /^ask(?:ed)? (\S+) to (.+)$/i.exec(text); // as heard: "asked climate to ..."
  let handOffs = null;
  if (text.startsWith("delegate ")) {
    handOffs = text
      .slice("delegate ".length)
      .split(" | ")
      .map((part) => ({
        agent: part.split(":")[0].trim(),
        instruction: part.split(":").slice(1).join(":").trim(),
      }));
  } else if (askTo) {
    handOffs = [{ agent: askTo[1].toLowerCase(), instruction: askTo[2] }];
  } else if (forAgent) {
    handOffs = [{ agent: forAgent, instruction: text }];
  }
  if (handOffs) {
    (async () => {
      const outcomes = [];
      for (const { agent, instruction } of handOffs) {
        const handed = await appTool("delegate", { agent, title: instruction.slice(0, 40), instruction });
        outcomes.push(handed.error ? `${agent} failed (${handed.error})` : `${agent} ${handed.status}`);
      }
      say(`Handed out: ${outcomes.join(", ")}`);
    })();
    return true;
  }
  if (text === "status" || text.startsWith("stop ")) {
    (async () => {
      const status = await appTool("team_status", {});
      if (text === "status") {
        const busy = status.agents.filter((a) => a.task || a.queued.length);
        const line = (a) => `${a.name}: ${a.task?.title ?? a.queued[0].title} (${a.state})`;
        say(busy.length ? busy.map(line).join("; ") : "All idle.");
        return;
      }
      const agent = status.agents.find((a) => a.name === text.slice("stop ".length));
      if (!agent?.task) return say("Nothing to stop.");
      const cancelled = await appTool("cancel_task", { taskId: agent.task.id });
      say(`Stopping ${agent.name}: ${cancelled.status}`);
    })();
    return true;
  }
  return false;
}

function onRequest(raw) {
  init();
  let text = raw;
  let forAgent = null;
  if (text.startsWith("[task] ")) text = text.slice(text.indexOf("\n") + 1);
  const target = /^\[for: ([^\]]+)\]\n/.exec(text);
  if (target) {
    forAgent = target[1];
    text = text.slice(target[0].length);
  }
  if (text === "crash") process.exit(3);
  history.push(text);
  writeFileSync(historyFile, JSON.stringify(history));
  // A spoken request's "[context] ..." line (what the user pointed at) comes before what they said.
  const said = text.replace(/^\[context\][^\n]*\n/, "");
  if (asLead(forAgent ? text : said, forAgent)) return;
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
    }).then(({ output, failed }) => {
      delta(failed ? `That failed: ${output}` : "Added a column.");
      result();
    });
    return;
  }
  const columns = /^columns (\d+)$/.exec(text);
  if (columns) {
    (async () => {
      for (let i = 0; i < Number(columns[1]); i++) {
        const element = {
          type: "column",
          name: `Fake column ${i + 1}`,
          position: [i * 4000, -8000],
          section: [400, 400],
          height: 3000,
        };
        await appTool("create_elements", { elements: [element] });
      }
      delta(`Added ${columns[1]} columns.`);
      result();
    })();
    return;
  }
  if (text === "winter shadows") {
    (async () => {
      const study = await appTool("sun_study", {
        date: "2026-12-21",
        time: "12:00",
        latitude: 51.5,
        longitude: 0,
      });
      delta(
        study.error ? `No study: ${study.error}` : `Sun at ${study.altitude} degrees from the ${study.from}.`,
      );
      result();
    })();
    return;
  }
  if (text === "two sentences") {
    delta("Architect is on the stair core. ");
    setTimeout(() => {
      delta("Climate is running the winter study.");
      result();
    }, 1500);
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
  const work = /^work (\d+)$/.exec(text);
  if (work) {
    const started = Date.now();
    slowTimer = setInterval(() => {
      delta(". ");
      if (Date.now() - started >= Number(work[1])) {
        clearInterval(slowTimer);
        slowTimer = null;
        delta(`Finished ${text}`);
        result();
      }
    }, 50);
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
  const agent = flag("--agent") ?? "default";
  const reply = `agent=${agent} pid=${process.pid} turn=${history.length} previous=${history.at(-2) ?? "none"}`;
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
