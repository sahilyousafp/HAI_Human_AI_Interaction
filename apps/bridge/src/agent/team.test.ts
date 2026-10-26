import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent, AgentTurn, Message, TeamTask } from "@hai/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { fakeProvider } from "../../test/fake-provider.ts";
import { connectClient } from "../../test/ws-client.ts";
import { type Bridge, createBridge } from "../server.ts";
import { agentDir, writeSessionId } from "./agent-config.ts";
import { agentsDir, defaultRoster, managedDefinition, readRoster } from "./roster.ts";
import type { Team } from "./team.ts";

const ORIGIN = "http://localhost:5173";
const TOKEN = "team-test-token-0123456789";
const temp = (prefix: string) => mkdtempSync(join(tmpdir(), prefix));
let bridge: Bridge | null = null;
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.close();
  await bridge?.stop();
  bridge = null;
});

async function start(options: { maxRunning?: number; before?: (projectDir: string) => void } = {}) {
  const stateDir = temp("hai-fake-state-");
  const projectDir = join(temp("hai-team-"), "project");
  bridge = createBridge({
    host: "127.0.0.1",
    port: 0,
    allowedOrigins: [ORIGIN],
    version: "t",
    token: TOKEN,
    scene: { projectDir, saveDelayMs: 50 },
    agent: {
      provider: fakeProvider(stateDir),
      ...(options.maxRunning ? { maxRunning: options.maxRunning } : {}),
    },
  });
  const address: AddressInfo = await bridge.start();
  const team = bridge.agent as Team;
  await team.ready;
  options.before?.(bridge.scene.projectDir ?? "");
  const viewer = await connectClient(address, { token: TOKEN, origin: ORIGIN, track: sockets });
  /** Every process the fake CLI started, with its flags. */
  const starts = () =>
    readdirSync(stateDir)
      .filter((f) => f.startsWith("start-"))
      .map((f) => JSON.parse(readFileSync(join(stateDir, f), "utf8")) as { args: string[] });
  return { team, viewer, scene: bridge.scene, projectDir: bridge.scene.projectDir ?? "", starts };
}

const replyOf = (turn?: AgentTurn) =>
  (turn?.events ?? [])
    .filter((e): e is Extract<AgentEvent, { type: "text.delta" }> => e.type === "text.delta")
    .map((e) => e.text)
    .join("");

function transcript(team: Team, agent: string): AgentTurn[] {
  const sent: Message[] = [];
  team.hub(agent).greet((m) => sent.push(m));
  const first = sent[0];
  return first?.type === "agent.transcript" ? first.payload.turns : [];
}

const task = (team: Team, agent: string): TeamTask => {
  const found = team.board.findLast((t) => t.agent === agent);
  if (!found) throw new Error(`no task for ${agent}`);
  return found;
};

describe("the team with the fake Claude Code CLI", () => {
  it("defaults created once: the first request creates the team, and Mochi runs on its own definition", async () => {
    const { team, projectDir, starts } = await start();
    expect(existsSync(agentsDir(projectDir))).toBe(false);
    await team.request("hello");
    expect(readdirSync(agentsDir(projectDir)).sort()).toEqual([
      "architect.md",
      "climate.md",
      "mochi.md",
      "product.md",
      "reviewer.md",
      "simulation.md",
      "urban.md",
    ]);
    expect(replyOf(transcript(team, "mochi")[0])).toContain("agent=mochi");
    expect(starts()[0]?.args).toContain("--agent");
    // Mochi's prompt carries the team it can hand work to.
    const prompt = readFileSync(join(agentDir(projectDir, "mochi"), "system.md"), "utf8");
    expect(prompt).toContain("- architect: Architecture");
    expect(prompt).not.toContain("- mochi:");
  });

  it("an earlier single conversation continues as Mochi's", async () => {
    const { team, starts } = await start({
      before: (dir) => {
        const lead = readRoster(dir).find((m) => m.lead) ?? defaultRoster().find((m) => m.lead);
        writeSessionId(
          dir,
          "earlier-conversation",
          undefined,
          lead ? managedDefinition(lead).tools.join(",") : "",
        );
      },
    });
    await team.request("hello");
    const [mochi] = starts();
    expect(mochi?.args[(mochi?.args.indexOf("--agent") ?? 0) + 1]).toBe("mochi");
    expect(mochi?.args[(mochi?.args.indexOf("--resume") ?? 0) + 1]).toBe("earlier-conversation");
  });

  it("an agent whose old file lists only the first eight tools is still started with Python and panels", async () => {
    const { team, starts } = await start({
      before: (dir) => {
        mkdirSync(agentsDir(dir), { recursive: true });
        writeFileSync(
          join(agentsDir(dir), "architect.md"),
          "---\nname: architect\ndescription: Architecture.\ntools: mcp__hai__get_elements, mcp__hai__create_elements\nmodel: sonnet\n---\n\nYou are Architect.\n",
        );
      },
    });
    await team.request("delegate architect: work 100");
    await team.settled();
    const [architect] = starts().filter((s) => s.args.includes("architect"));
    const path = architect?.args[(architect?.args.indexOf("--agents") ?? 0) + 1] ?? "";
    expect(path).toMatch(/agent[\\/]architect[\\/]agents\.json$/);
    const definition = JSON.parse(readFileSync(path, "utf8")).architect;
    expect(definition.tools).toEqual(
      expect.arrayContaining([
        "mcp__hai__get_elements",
        "mcp__hai__python_run",
        "mcp__hai__offer_panel",
        "mcp__hai__open_panel",
        "mcp__hai__set_view",
      ]),
    );
    expect(definition.prompt).toBe("You are Architect.");
  });

  it("a conversation started under older instructions is not resumed: the agent starts a new one", async () => {
    const { team, starts } = await start({
      before: (dir) => {
        const folder = agentDir(dir, "mochi");
        mkdirSync(folder, { recursive: true });
        // As an earlier version of HAI saved it: no mention of the instructions it was started under.
        writeFileSync(join(folder, "session.json"), JSON.stringify({ sessionId: "said-it-cannot-be-done" }));
      },
    });
    await team.request("hello");
    const [mochi] = starts();
    expect(mochi?.args).not.toContain("--resume");
  });

  it("two specialists at once: both run in their own sessions, and Mochi's turn ends without waiting", async () => {
    const { team, viewer, starts } = await start();
    const turn = await team.request("delegate architect: work 900 | climate: work 900");
    expect(replyOf(turn)).toBe("Handed out: architect running, climate running");
    // Mochi is done while both specialists work.
    await vi.waitFor(() => expect(team.board.filter((t) => t.status === "running")).toHaveLength(2));
    expect(team.hub("mochi").runningTurn).toBeNull();
    await team.settled();
    expect(task(team, "architect")).toMatchObject({
      status: "done",
      summary: expect.stringMatching(/Finished work 900$/),
    });
    expect(task(team, "climate").status).toBe("done");
    const agents = starts().map((s) => s.args[s.args.indexOf("--agent") + 1]);
    expect(agents.sort()).toEqual(["architect", "climate", "mochi"]);
    // Their turns are each in their own transcript, marked as the task's.
    const architectTurn = transcript(team, "architect")[0];
    expect(architectTurn).toMatchObject({
      kind: "task",
      taskId: task(team, "architect").id,
      request: "work 900",
    });
    expect(task(team, "architect").turnId).toBe(architectTurn?.id);
    // The page saw the board change.
    expect(viewer.received.some((m) => m.type === "team.snapshot" && m.payload.tasks.length === 2)).toBe(
      true,
    );
  });

  it("delegate returns while the task is still to be done", async () => {
    const { team } = await start();
    await team.request("hello"); // the team is read
    // No clock: a long task is still queued or running when the call returns, so the call did not wait for it.
    const handed = team.delegate({ agent: "reviewer", title: "Check heights", instruction: "work 400" });
    expect(handed).toMatchObject({ ok: true });
    const reviewer = (team.status() as { agents: Array<{ name: string; state: string }> }).agents.find(
      (a) => a.name === "reviewer",
    );
    expect(["queued", "working"]).toContain(reviewer?.state);
    await team.settled();
  });

  it("an unknown specialist is refused, naming the team", async () => {
    const { team } = await start();
    await team.request("hello");
    expect(team.delegate({ agent: "plumber", title: "x", instruction: "y" })).toEqual({
      ok: false,
      error:
        "There is no specialist called plumber. The team: architect, climate, product, reviewer, simulation, urban.",
    });
    expect(team.delegate({ agent: "mochi", title: "x", instruction: "y" })).toMatchObject({ ok: false });
  });

  it("second writer queues: Product waits for Architect, while Reviewer reads alongside", async () => {
    const { team } = await start();
    await team.request("delegate architect: work 700 | product: work 100 | reviewer: work 300");
    await vi.waitFor(() => expect(task(team, "reviewer").status).toBe("running"));
    expect(task(team, "architect").status).toBe("running");
    expect(task(team, "product").status).toBe("queued");
    await team.settled();
    const architect = task(team, "architect");
    const product = task(team, "product");
    expect(product.status).toBe("done");
    expect(product.startedAt ?? 0).toBeGreaterThanOrEqual(architect.finishedAt ?? Number.POSITIVE_INFINITY);
  });

  it("at most maxRunning specialists work at once", async () => {
    const { team } = await start({ maxRunning: 1 });
    await team.request("delegate reviewer: work 200 | climate: work 200");
    await vi.waitFor(() => expect(task(team, "reviewer").status).toBe("running"));
    expect(task(team, "climate").status).toBe("queued");
    await team.settled();
    expect(task(team, "climate").startedAt ?? 0).toBeGreaterThanOrEqual(
      task(team, "reviewer").finishedAt ?? 0,
    );
  });

  it("one undo per specialist task: four columns go with one undo labelled with Architect's task", async () => {
    const { team, viewer, scene } = await start();
    await team.request("delegate architect: columns 4");
    await team.settled();
    const fake = () =>
      Object.values(scene.scene.doc.elements).filter((e) => e.name.startsWith("Fake column"));
    expect(fake()).toHaveLength(4);
    viewer.send("scene.undo", {});
    const undo = await viewer.waitFor("scene.patch", (m) => m.payload.kind === "undo");
    expect(undo.payload.label).toBe("Architect: columns 4");
    expect(fake()).toEqual([]);
  });

  it("report when done: once both tasks finish, Mochi reports both results", async () => {
    const { team } = await start();
    await team.request("delegate architect: work 200 | climate: work 400");
    await team.settled();
    const turns = transcript(team, "mochi");
    expect(turns.map((t) => t.kind)).toEqual(["request", "digest"]);
    const report = replyOf(turns[1]);
    expect(report).toMatch(/^Report: /);
    expect(report).toContain('Architect "work 200": done. . ');
    expect(report).toContain('Climate "work 400": done.');
  });

  it("status while working: Mochi names both busy agents and their tasks, and both keep running", async () => {
    const { team } = await start();
    await team.request("delegate architect: work 2000 | climate: work 2000");
    await vi.waitFor(() => expect(team.board.filter((t) => t.status === "running")).toHaveLength(2));
    const status = await team.request("status");
    expect(replyOf(status)).toBe("architect: work 2000 (working); climate: work 2000 (working)");
    expect(team.board.map((t) => t.status)).toEqual(["running", "running"]);
    await team.settled();
    expect(team.board.map((t) => t.status)).toEqual(["done", "done"]);
  });

  it("a report waits while the user's own turn with Mochi runs", async () => {
    const { team } = await start();
    await team.request("delegate reviewer: work 100");
    await team.request("work 700"); // Mochi is busy with the user while Reviewer finishes
    await team.settled();
    expect(transcript(team, "mochi").map((t) => t.kind)).toEqual(["request", "request", "digest"]);
  });

  it("stop one task: within 3 s Architect's task is stopped and Climate keeps working", async () => {
    const { team } = await start();
    await team.request("delegate architect: work 8000 | climate: work 1500");
    await vi.waitFor(() => expect(team.board.filter((t) => t.status === "running")).toHaveLength(2));
    const stoppedAt = Date.now();
    team.cancel(task(team, "architect").id);
    await vi.waitFor(() => expect(task(team, "architect").status).toBe("stopped"), { timeout: 3000 });
    expect(Date.now() - stoppedAt).toBeLessThan(3000);
    expect(task(team, "climate").status).toBe("running");
    await team.settled();
    expect(task(team, "climate").status).toBe("done");
  });

  it("asking Mochi to stop a specialist cancels its task", async () => {
    const { team } = await start();
    await team.request("delegate architect: work 8000");
    await vi.waitFor(() => expect(task(team, "architect").status).toBe("running"));
    expect(replyOf(await team.request("stop architect"))).toBe("Stopping architect: stopping");
    await vi.waitFor(() => expect(task(team, "architect").status).toBe("stopped"), { timeout: 3000 });
  });

  it("stop everything: running and queued tasks stop, and no report follows", async () => {
    const { team, viewer } = await start();
    await team.request("delegate architect: work 8000 | product: work 100");
    await vi.waitFor(() => expect(task(team, "architect").status).toBe("running"));
    viewer.send("agent.stop", {});
    await team.settled();
    expect(team.board.map((t) => t.status)).toEqual(["stopped", "stopped"]);
    expect(transcript(team, "mochi").map((t) => t.kind)).toEqual(["request"]);
  });

  it("a task waiting for the user's approval shows as waiting, and runs on once allowed", async () => {
    const { team, viewer } = await start();
    await team.request("delegate architect: shell: echo hi");
    const card = await viewer.waitFor("approval.pending");
    expect(card.payload.agent).toBe("architect");
    await vi.waitFor(() => expect(task(team, "architect").status).toBe("waiting"));
    viewer.send("approval.decide", { id: card.payload.id, decision: "allow" });
    await team.settled();
    expect(task(team, "architect")).toMatchObject({ status: "done", summary: "Done: ran: echo hi" });
  });

  it("a request naming a specialist reaches Mochi with the name, and Mochi hands it over", async () => {
    const { team } = await start();
    const turn = await team.request("work 100", undefined, "climate");
    expect(replyOf(turn)).toBe("Handed out: climate running");
    expect(turn.request).toBe("work 100"); // the transcript shows what the user said
    await team.settled();
    expect(task(team, "climate").status).toBe("done");
  });

  it("a new specialist is routable: a new definition joins Mochi's team from the next request", async () => {
    const { team, projectDir, starts } = await start();
    await team.request("hello");
    writeFileSync(
      join(agentsDir(projectDir), "structure.md"),
      "---\nname: structure\ndescription: Structural sizing of beams and columns.\ntools: mcp__hai__get_elements\n---\n\nYou are Structure.\n",
    );
    await team.request("delegate structure: work 100");
    await team.settled();
    expect(task(team, "structure").status).toBe("done");
    // Mochi was restarted with the new roster, resuming its conversation (starts are not in order).
    const mochiStarts = starts().filter((s) => s.args.includes("mochi"));
    expect(mochiStarts).toHaveLength(2);
    expect(mochiStarts.filter((s) => s.args.includes("--resume"))).toHaveLength(1);
    expect(readFileSync(join(agentDir(projectDir, "mochi"), "system.md"), "utf8")).toContain(
      "- structure: Structural sizing",
    );
  });

  it("an agent added or edited in the Agents tab is written as files and applies from its next task", async () => {
    const { team, viewer, projectDir, starts } = await start();
    await team.request("delegate architect: work 100");
    await team.settled();
    const structure = {
      name: "structure",
      description: "Sizes beams and columns.",
      model: "sonnet",
      tools: ["mcp__hai__get_elements", "mcp__hai__update_elements"],
      aliases: ["struct"],
      color: "#aa5500",
      prompt: "You are Structure.",
    };
    viewer.send("agents.save", { agent: structure });
    const saved = await viewer.waitFor("agents.snapshot", (m) => m.payload.saved === "structure");
    expect(saved.payload.definitions.find((d) => d.name === "structure")).toMatchObject({
      ...structure,
      writes: true,
      lead: false,
    });
    expect(readFileSync(join(agentsDir(projectDir), "structure.md"), "utf8")).toBe(
      "---\nname: structure\ndescription: Sizes beams and columns.\ntools: mcp__hai__get_elements, mcp__hai__update_elements\nmodel: sonnet\n---\n\nYou are Structure.\n",
    );
    expect(JSON.parse(readFileSync(join(projectDir, ".hai", "agents.json"), "utf8")).structure).toEqual({
      aliases: ["struct"],
      color: "#aa5500",
      writes: true,
    });
    // Changing Architect's tools restarts its process for its next task, and starts a new conversation: the old one
    // was held under other tools, and an agent resuming it keeps to what it said it could not do.
    const onlyCores = {
      ...structure,
      name: "architect",
      description: "Only cores.",
      tools: ["mcp__hai__get_elements"],
    };
    viewer.send("agents.save", { agent: onlyCores });
    await viewer.waitFor("agents.snapshot", (m) => m.payload.saved === "architect");
    await team.request("delegate architect: work 100");
    await team.settled();
    let architectStarts = starts().filter((s) => s.args.includes("architect"));
    expect(architectStarts).toHaveLength(2);
    expect(architectStarts.filter((s) => s.args.includes("--resume"))).toHaveLength(0);
    // Changing only what it says about itself keeps the conversation.
    viewer.send("agents.save", { agent: { ...onlyCores, description: "Only cores and stairs." } });
    await viewer.waitFor("agents.snapshot", (m) =>
      m.payload.definitions.some((d) => d.description === "Only cores and stairs."),
    );
    await team.request("delegate architect: work 100");
    await team.settled();
    architectStarts = starts().filter((s) => s.args.includes("architect"));
    expect(architectStarts).toHaveLength(3);
    expect(architectStarts.filter((s) => s.args.includes("--resume"))).toHaveLength(1);
  });

  it("the lead keeps its delegate tool", async () => {
    const { team, viewer } = await start();
    await team.request("hello");
    viewer.send("agents.save", {
      agent: {
        name: "mochi",
        description: "Lead.",
        tools: [],
        aliases: [],
        color: "#d98fb6",
        prompt: "Lead.",
      },
    });
    const refused = await viewer.waitFor("request.error");
    expect(refused.payload.message).toBe("Mochi leads the team: keep its delegate tool.");
  });
});

describe("the close note for a generated panel", () => {
  const document = { title: "Clearance", width: 320, height: 240, html: "<p>hi</p>" };

  /** Architect offers, the page accepts, Architect opens, and the page reports it loaded. */
  async function openPanel(viewer: Awaited<ReturnType<typeof start>>["viewer"]) {
    const panels = (bridge as Bridge).panels;
    const offered = panels.offer("architect", "Set the clearance");
    const offer = await viewer.waitFor("panel.offer", (m) => m.payload.state === "waiting");
    viewer.send("panel.offer.answer", { offerId: offer.payload.offerId, answer: "accepted" });
    await offered;
    const opened = panels.open("architect", document);
    const panelId = (await viewer.waitFor("panel.open")).payload.panelId;
    viewer.send("panel.status", { panelId, state: "ready" });
    await opened;
    return panelId;
  }
  const notes = (team: Team, agent: string) =>
    transcript(team, agent).filter((t) => t.request.startsWith("[panel]"));

  it("after Done the agent that opened the panel hears once that the result was kept", async () => {
    const { team, viewer } = await start();
    await team.request("hello");
    const panelId = await openPanel(viewer);
    viewer.send("panel.closed", { panelId, outcome: "kept" });
    await vi.waitFor(() => expect(notes(team, "architect")).toHaveLength(1));
    await team.settled();
    expect(notes(team, "architect")).toHaveLength(1);
    expect(notes(team, "architect")[0]).toMatchObject({
      kind: "digest",
      request: expect.stringContaining('the panel "Clearance" and kept the result'),
    });
    // Nobody else is told.
    expect(notes(team, "mochi")).toHaveLength(0);
  });

  it("after Close the agent hears that the result was discarded", async () => {
    const { team, viewer } = await start();
    await team.request("hello");
    const panelId = await openPanel(viewer);
    viewer.send("panel.closed", { panelId, outcome: "discarded" });
    await vi.waitFor(() => expect(notes(team, "architect")).toHaveLength(1));
    expect(notes(team, "architect")[0]?.request).toContain("discarded the result");
  });

  it("Mochi's information panel: on close it hears the model is unchanged, and that a change was refused", async () => {
    const { team, viewer } = await start();
    await team.request("hello");
    const panels = (bridge as Bridge).panels;
    const offered = panels.offer("mochi", "Show the status");
    const offer = await viewer.waitFor("panel.offer", (m) => m.payload.state === "waiting");
    viewer.send("panel.offer.answer", { offerId: offer.payload.offerId, answer: "accepted" });
    await offered;
    const opened = panels.open("mochi", document, true);
    const panelId = (await viewer.waitFor("panel.open")).payload.panelId;
    viewer.send("panel.status", { panelId, state: "ready" });
    await opened;
    viewer.send("panel.refused", { panelId, attempt: "commit" });
    viewer.send("panel.closed", { panelId, outcome: "discarded" });
    await vi.waitFor(() => expect(notes(team, "mochi")).toHaveLength(1));
    expect(notes(team, "mochi")[0]?.request).toContain("information panel");
    expect(notes(team, "mochi")[0]?.request).toContain("the model is unchanged");
    expect(notes(team, "mochi")[0]?.request).toContain("tried to change the model");
  });

  it("an agent that closes its own panel is not told about it", async () => {
    const { team, viewer } = await start();
    await team.request("hello");
    await openPanel(viewer);
    expect((bridge as Bridge).panels.close("architect")).toEqual({ ok: true });
    await team.settled();
    expect(notes(team, "architect")).toHaveLength(0);
  });

  it("while the agent is busy the note waits, and arrives once after its turn", async () => {
    const { team, viewer } = await start();
    await team.request("delegate architect: work 1500");
    await vi.waitFor(() => expect(team.board.some((t) => t.status === "running")).toBe(true));
    const panelId = await openPanel(viewer);
    viewer.send("panel.closed", { panelId, outcome: "kept" });
    await vi.waitFor(() => expect(team.board.some((t) => t.status === "running")).toBe(true));
    expect(notes(team, "architect")).toHaveLength(0);
    await team.settled();
    const turns = transcript(team, "architect");
    expect(turns.map((t) => t.kind)).toEqual(["task", "digest"]);
    expect(notes(team, "architect")).toHaveLength(1);
  });

  it("a turn that ends with its offer unanswered leaves 'No panel was made'", async () => {
    const { team, viewer } = await start();
    await team.request("delegate architect: work 300");
    await vi.waitFor(() => expect(team.board.some((t) => t.status === "running")).toBe(true));
    const offered = (bridge as Bridge).panels.offer("architect", "Set the clearance");
    await viewer.waitFor("panel.offer", (m) => m.payload.state === "waiting");
    await team.settled();
    expect(await offered).toMatchObject({ ok: true, answer: "expired" });
    await viewer.waitFor("panel.offer", (m) => m.payload.state === "unused");
    expect((bridge as Bridge).panels.active).toBe(false);
  });

  it("stopping the team ends a waiting offer too", async () => {
    const { team, viewer } = await start();
    await team.request("delegate architect: work 5000");
    await vi.waitFor(() => expect(team.board.some((t) => t.status === "running")).toBe(true));
    void (bridge as Bridge).panels.offer("architect", "Set the clearance");
    await viewer.waitFor("panel.offer", (m) => m.payload.state === "waiting");
    viewer.send("agent.stop", {});
    await viewer.waitFor("panel.offer", (m) => m.payload.state === "unused");
  });
});
