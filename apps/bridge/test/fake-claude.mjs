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
//   "panel"      offers a panel (offer_panel); if the user accepts, opens a clearance slider that moves col-a1
//   "panel HTML" the same with HTML as the panel document, for tests that need a particular panel
//   "panel wait N"  the same, but writes the panel N ms after the user accepted (the loading state shows meanwhile)
//   "panel stay"  the same, then keeps the turn running (stoppable like "slow") while the panel is open
//   "panel update HTML"  replaces the open panel's document, then replies
//   "panel close"  closes the open panel
//   "view JSON"   sets the user's view (set_view) with JSON as its input, e.g. view {"azimuth":225}
//   "python write FILE"  runs a Python script (python_run) that copies the .3dm FILE into the project, as a model
//                        that wrote a file would; "python box" builds a 2 x 1 x 3 m box with rhino3dm and saves it
//                        through hai_3dm; "python packages A" runs a long script that asks to install A
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
// `--version` and `auth status --json` answer as an installed, signed-in Claude Code (see the env switches below).
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

// The checks the app runs before it starts a session. FAKE_CLAUDE_VERSION_FAILS=1 makes `--version` fail (installed
// but does not start); FAKE_CLAUDE_LOGGED_IN=0 reports no signed-in account.
if (args[0] === "--version") {
  if (process.env.FAKE_CLAUDE_VERSION_FAILS === "1") process.exit(1);
  process.stdout.write("2.1.303 (Claude Code)\n");
  process.exit(0);
}
if (args[0] === "auth" && args[1] === "status") {
  process.stdout.write(`${JSON.stringify({ loggedIn: process.env.FAKE_CLAUDE_LOGGED_IN !== "0" })}\n`);
  process.exit(0);
}

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
  const config = JSON.parse(readFileSync(flag("--mcp-config"), "utf8")).mcpServers.hai;
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
  const prompt = flag("--permission-prompt-tool").replace(/^mcp__hai__/, "");
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
    tools: ["Read", "Bash", "mcp__hai__get_scene_summary"],
    mcp_servers: [
      { name: "hai", status: "connected", source: "dynamic" },
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
  const { output } = await toolCall(`mcp__hai__${name}`, input, async (allowed) => {
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

/** The panel the fake agent writes by default: a clearance slider that previews moving column col-a1. */
const SAMPLE_PANEL = `<h2>Column clearance</h2>
<label for="s">Clearance <output id="v">150</output> mm</label>
<input id="s" type="range" min="50" max="400" step="10" value="150">
<p id="state">Within tolerance</p>
<button id="apply" type="button">Apply</button>
<script>
  const slider = document.getElementById("s"), out = document.getElementById("v"), state = document.getElementById("state");
  let base = null;
  hai.scene.get({ ids: ["col-a1"] }).then(({ elements }) => { base = elements[0]; });
  function move() {
    out.textContent = slider.value;
    const ok = Number(slider.value) >= 100 && Number(slider.value) <= 300;
    state.textContent = ok ? "Within tolerance" : "Outside 100-300 mm";
    state.style.color = ok ? "" : "var(--risk)";
    if (base) hai.preview([{ op: "update", id: base.id, patch: { position: [base.position[0] + Number(slider.value) - 150, base.position[1]] } }]);
  }
  slider.addEventListener("input", move);
  document.getElementById("apply").addEventListener("click", () => hai.commit());
</script>`;

/** "panel", "panel HTML", "panel update HTML" or "panel close": the panel tools, as a model that writes panels would. */
async function panelRequest(rest) {
  if (rest === "close") {
    const closed = await appTool("close_panel", {});
    delta(closed.error ? `Close refused: ${closed.error}` : "Panel closed.");
    result();
    return;
  }
  if (rest.startsWith("update ")) {
    const updated = await appTool("update_panel", { html: rest.slice("update ".length) });
    delta(updated.error ? `Update failed: ${updated.error}` : "Panel updated.");
    result();
    return;
  }
  const offer = await appTool("offer_panel", { purpose: "Set the wall to column clearance" });
  if (offer.error || offer.answer !== "accepted") {
    delta(offer.error ? `Offer refused: ${offer.error}` : `Offer ${offer.answer}.`);
    result();
    return;
  }
  const wait = /^wait (\d+)$/.exec(rest);
  if (wait) await new Promise((resolve) => setTimeout(resolve, Number(wait[1])));
  const opened = await appTool("open_panel", {
    title: "Clearance",
    width: 320,
    height: 260,
    html: !rest || wait || rest === "stay" ? SAMPLE_PANEL : rest,
  });
  delta(opened.error ? `Panel failed: ${opened.error}` : "Panel ready.");
  if (rest === "stay") {
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
  result();
}

/** "view JSON": the camera tool, as a model that wants to show something would call it. */
async function viewRequest(json) {
  let input;
  try {
    input = JSON.parse(json);
  } catch {
    delta("The view request was not JSON.");
    result();
    return;
  }
  const moved = await appTool("set_view", input);
  delta(moved.error ? `View refused: ${moved.error}` : "View set.");
  result();
}

/** "python write FILE" or "python packages A,B": the Python workbench, as a model that writes files would use it. */
async function pythonRequest(rest) {
  const write = /^write (.+)$/.exec(rest);
  const packages = /^packages (.+)$/.exec(rest);
  const input =
    rest === "box"
      ? {
          title: "A box",
          code: [
            "import rhino3dm as r",
            "import hai_3dm",
            "model = r.File3dm()",
            "box = r.Brep.CreateFromBoundingBox(r.BoundingBox(r.Point3d(0, 0, 0), r.Point3d(2000, 1000, 3000)))",
            "hai_3dm.add(model, box, 'Box', 'Structure')",
            "hai_3dm.save(model, 'box.3dm')",
            "",
          ].join("\n"),
        }
      : write
        ? {
            title: "Write a box",
            code: `import shutil\nshutil.copy(${JSON.stringify(write[1])}, "written-box.3dm")\nprint("written")\n`,
          }
        : {
            title: "Ladybug study",
            // Long enough that the approval card has to scroll.
            code: `import ladybug\n${Array.from({ length: 60 }, (_, i) => `# study step ${i + 1}`).join("\n")}\nprint(ladybug.__name__)\n`,
            packages: (packages?.[1] ?? "").split(","),
          };
  const ran = await appTool("python_run", input);
  delta(ran.error ? `Python refused: ${ran.error}` : `Python ${ran.ok ? "ran" : "failed"}.`);
  result();
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
  if (text === "panel" || text.startsWith("panel ")) {
    void panelRequest(text.slice("panel".length).trim());
    return;
  }
  if (text.startsWith("view ")) {
    void viewRequest(text.slice("view ".length));
    return;
  }
  if (text.startsWith("python ")) {
    void pythonRequest(text.slice("python ".length));
    return;
  }
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
    const tool = "mcp__hai__create_elements";
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
