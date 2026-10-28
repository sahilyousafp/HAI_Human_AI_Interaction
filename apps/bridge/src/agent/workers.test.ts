import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TeamTask } from "@hai/protocol";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { fakeProvider } from "../../test/fake-provider.ts";
import { connectClient } from "../../test/ws-client.ts";
import { type Bridge, createBridge } from "../server.ts";
import type { Team } from "./team.ts";

/** A worker is a process, and a busy machine takes longer to start one: every wait here allows for that. */
const waitFor = <T>(check: () => T | Promise<T>, options: { timeout?: number } = {}) =>
  vi.waitFor(check, { timeout: 15_000, ...options });

const ORIGIN = "http://localhost:5173";
const TOKEN = "workers-test-token-0123456789";
const temp = (prefix: string) => mkdtempSync(join(tmpdir(), prefix));
let bridge: Bridge | null = null;
const sockets: WebSocket[] = [];
const clients: Client[] = [];

afterEach(async () => {
  await (bridge?.agent as Team | null)?.stopAll();
  for (const c of clients.splice(0)) await c.close();
  for (const ws of sockets.splice(0)) ws.close();
  await bridge?.stop();
  bridge = null;
});

async function start() {
  const stateDir = temp("hai-fake-state-");
  const projectDir = join(temp("hai-workers-"), "project");
  bridge = createBridge({
    host: "127.0.0.1",
    port: 0,
    allowedOrigins: [ORIGIN],
    version: "t",
    token: TOKEN,
    scene: { projectDir, saveDelayMs: 50 },
    agent: { provider: fakeProvider(stateDir) },
  });
  const address: AddressInfo = await bridge.start();
  const team = bridge.agent as Team;
  await team.ready;
  const viewer = await connectClient(address, { token: TOKEN, origin: ORIGIN, track: sockets });
  const mcp = async (agent: string) => {
    const client = new Client({ name: agent, version: "1.0.0" });
    const token = (bridge as Bridge).agentTokens.issue({ agent, tools: null });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    clients.push(client);
    return client;
  };
  return { team, viewer, scene: (bridge as Bridge).scene, mcp, stateDir, projectDir };
}

const taskOf = (team: Team, agent: string): TeamTask => {
  const found = team.board.findLast((t) => t.agent === agent);
  if (!found) throw new Error(`no task for ${agent}`);
  return found;
};
const workers = (team: Team) => team.board.filter((t) => t.kind === "worker");
const textOf = (result: { content?: unknown }) =>
  (result.content as Array<{ text?: string }> | undefined)?.[0]?.text ?? "";
const owned = (scene: Bridge["scene"], agent: string) =>
  Object.values(scene.scene.doc.elements).filter((e) => e.tags?.["hai.owner"] === agent);
const PAVILION = "delegate architect[pavilion]: ";
/** What an agent said in its replies, as the pages saw it. */
const said = (viewer: Awaited<ReturnType<typeof start>>["viewer"], agent: string) =>
  viewer.received
    .flatMap((m) =>
      m.type === "agent.event" && m.payload.agent === agent && m.payload.event.type === "text.delta"
        ? [m.payload.event.text]
        : [],
    )
    .join("");

describe("a specialist starts workers", () => {
  it("two workers run together under their own names, claims and undo steps, and the task ends after them", async () => {
    const { team, scene, viewer, stateDir, projectDir } = await start();
    await team.request(
      `${PAVILION}spawn dome[pavilion/dome]: columns 3 every 150 ;; minarets[pavilion/minarets]: columns 3 every 250`,
    );
    await waitFor(() => expect(workers(team)).toHaveLength(2));
    const [dome, minarets] = workers(team) as [TeamTask, TeamTask];
    const parent = taskOf(team, "architect");
    expect([dome.agent, minarets.agent]).toEqual(["architect.2", "architect.3"]);
    expect([dome.kind, dome.parent]).toEqual(["worker", parent.id]);
    expect(dome.scope).toEqual({ part: "pavilion/dome" });

    // Each worker has its claim, cut from the parent's.
    await waitFor(() => expect(team.claims.all).toHaveLength(3));
    expect(team.claims.all.filter((c) => c.parent === parent.id).map((c) => c.agent)).toEqual([
      "architect.2",
      "architect.3",
    ]);

    // The parent's own turn is over, but its task is not: it waits for its workers.
    await waitFor(() => expect(taskOf(team, "architect.2").status).toBe("running"));
    expect(taskOf(team, "architect").status).toBe("running");
    await team.settled();

    // Their working times overlap, and the parent ended after both.
    const [done1, done2, done] = [
      taskOf(team, "architect.2"),
      taskOf(team, "architect.3"),
      taskOf(team, "architect"),
    ];
    expect(done1.startedAt ?? 0).toBeLessThan(done2.finishedAt ?? 0);
    expect(done2.startedAt ?? 0).toBeLessThan(done1.finishedAt ?? 0);
    expect(done.finishedAt ?? 0).toBeGreaterThanOrEqual(
      Math.max(done1.finishedAt ?? 0, done2.finishedAt ?? 0),
    );
    expect([done1.status, done2.status, done.status]).toEqual(["done", "done", "done"]);
    // The parent heard from each worker, one turn each.
    const heard = viewer.received
      .filter(
        (m) => m.type === "agent.turn" && m.payload.agent === "architect" && m.payload.kind === "digest",
      )
      .map((m) => (m.type === "agent.turn" ? m.payload.request : ""))
      .join("\n");
    expect(heard).toContain('[worker report] Architect 2 "dome" done.');
    expect(heard).toContain('[worker report] Architect 3 "minarets" done.');
    expect(done.summary).toMatch(/^Heard: /);

    // Every element carries its worker as its owner and its sub-part.
    expect(owned(scene, "architect.2")).toHaveLength(3);
    expect(owned(scene, "architect.3")).toHaveLength(3);
    expect(owned(scene, "architect.2")[0]?.tags?.["hai.part"]).toBe("pavilion/dome");
    expect(team.claims.all).toHaveLength(0);

    // Each worker is its own undo step, the one that ended last first.
    viewer.send("scene.undo", {});
    const first = await viewer.waitFor("scene.patch", (m) => m.payload.kind === "undo");
    expect(first.payload.label).toBe("Architect 3: minarets");
    expect(owned(scene, "architect.3")).toHaveLength(0);
    expect(owned(scene, "architect.2")).toHaveLength(3);
    viewer.send("scene.undo", {});
    await waitFor(() => expect(owned(scene, "architect.2")).toHaveLength(0));

    // Each worker was its own process, started under its name with its own configuration.
    const starts = readdirSync(stateDir)
      .filter((f) => f.startsWith("start-"))
      .map((f) => JSON.parse(readFileSync(join(stateDir, f), "utf8")) as { pid: number; args: string[] });
    const flagOf = (args: string[], name: string) => args[args.indexOf(name) + 1];
    const named = (agent: string) => starts.find((s) => flagOf(s.args, "--agent") === agent);
    expect(named("architect.2")).toBeDefined();
    expect(named("architect.3")).toBeDefined();
    expect(flagOf(named("architect.2")?.args ?? [], "--mcp-config")).not.toBe(
      flagOf(named("architect.3")?.args ?? [], "--mcp-config"),
    );
    expect(flagOf(named("architect.2")?.args ?? [], "--agents")).toMatch(/architect\.2[\\/]agents\.json$/);

    // A worker's process ends with it: nothing is left running, and its files are gone.
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    const pids = starts
      .filter((s) => ["architect.2", "architect.3"].includes(flagOf(s.args, "--agent") ?? ""))
      .map((s) => s.pid);
    expect(pids).toHaveLength(2);
    await waitFor(() => expect(pids.map(alive)).toEqual([false, false]), { timeout: 4000 });
    expect(readdirSync(join(projectDir, ".hai", "agent")).filter((d) => d.includes("."))).toEqual([]);
  });

  it("a worker's own tools cannot start workers, and a worker that tries is refused", async () => {
    const { team } = await start();
    await team.request(`${PAVILION}spawn dome[pavilion/dome]: work 400`);
    await waitFor(() => expect(workers(team)).toHaveLength(1));
    expect(
      team.spawnWorker("architect.2", { title: "x", instruction: "y", scope: { part: "pavilion/x" } }),
    ).toEqual({
      ok: false,
      error: expect.stringMatching(/Workers cannot start workers/),
    });
    await team.settled();
  });

  it("is refused for Mochi, for a specialist with no task and for one that does not change the model", async () => {
    const { team } = await start();
    const refused = (agent: string) =>
      team.spawnWorker(agent, { title: "x", instruction: "y", scope: { part: "p" } });
    expect(refused("mochi")).toMatchObject({ ok: false, error: expect.stringMatching(/Only a specialist/) });
    expect(refused("reviewer")).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Only a specialist/),
    });
    expect(refused("architect")).toMatchObject({
      ok: false,
      error: expect.stringMatching(/no running task/),
    });
  });

  it("is refused while Parallel modelling is off, and says so", async () => {
    const { team, viewer } = await start();
    viewer.send("settings.set", { features: { parallelModelling: false } });
    await new Promise((r) => setTimeout(r, 100));
    await team.request(`${PAVILION}spawn dome[pavilion/dome]: work 100`);
    await team.settled();
    expect(workers(team)).toHaveLength(0);
    expect(said(viewer, "architect")).toMatch(/Parallel modelling is off/);
  });
});

describe("a worker's scope is cut from its parent's claim", () => {
  it("a part outside the parent's claim is refused, naming how a sub-part is written", async () => {
    const { team, viewer } = await start();
    await team.request(`${PAVILION}spawn harbour[harbour]: work 100 ;; dome[pavilion/dome]: work 300`);
    await team.settled();
    expect(said(viewer, "architect")).toMatch(
      /refused \(Not started: the part "harbour" is outside your claim; a part inside "pavilion" is written "pavilion\/<name>"/,
    );
    expect(workers(team)).toHaveLength(1);
    expect(workers(team)[0]?.scope).toEqual({ part: "pavilion/dome" });
  });

  it("a second worker overlapping a running worker is refused and names the first", async () => {
    const { team, viewer } = await start();
    await team.request(
      `${PAVILION}spawn dome[pavilion/dome]: work 600 ;; ribs[pavilion/dome/ribs]: work 100`,
    );
    await team.settled();
    expect(said(viewer, "architect")).toMatch(
      /refused \(Not started: the part "pavilion\/dome\/ribs" overlaps Architect 2's part "dome"/,
    );
    expect(workers(team)).toHaveLength(1);
  });

  it("the parent cannot change the worker's part while it runs, and the part returns when the worker ends", async () => {
    const { team, scene, mcp } = await start();
    await team.request(`${PAVILION}spawn dome[pavilion/dome]: columns 2 every 500`);
    // A worker is a process: starting one takes longer when the machine is busy.
    await waitFor(() => expect(owned(scene, "architect.2")).toHaveLength(1));
    const element = owned(scene, "architect.2")[0];
    const parent = await mcp("architect");
    const refused = await parent.callTool({
      name: "update_elements",
      arguments: { updates: [{ id: element?.id, patch: { name: "mine now" } }] },
    });
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toMatch(/architect\.2's task "dome"/);
    expect(scene.scene.doc.elements[element?.id as string]?.name).not.toBe("mine now");
    await team.settled();
  });
});

describe("stopping", () => {
  it("stopping the parent stops its workers and frees every claim within 3 seconds", async () => {
    const { team } = await start();
    await team.request(`${PAVILION}spawn a[pavilion/a]: work 20000 ;; b[pavilion/b]: work 20000`);
    await waitFor(() => expect(workers(team).filter((w) => w.status === "running")).toHaveLength(2));
    const started = Date.now();
    team.cancel(taskOf(team, "architect").id);
    await waitFor(
      () => {
        expect(team.board.every((t) => t.status === "stopped")).toBe(true);
        expect(team.claims.all).toHaveLength(0);
      },
      { timeout: 3000 },
    );
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("a worker that ignores the interrupt is ended for the parent within the limit", async () => {
    const { team } = await start();
    await team.request(`${PAVILION}spawn a[pavilion/a]: stubborn ;; b[pavilion/b]: work 20000`);
    await waitFor(() => expect(workers(team).filter((w) => w.status === "running")).toHaveLength(2));
    const started = Date.now();
    team.cancel(taskOf(team, "architect").id);
    await waitFor(
      () => {
        expect(team.board.every((t) => t.status === "stopped")).toBe(true);
        expect(team.claims.all).toHaveLength(0);
      },
      { timeout: 3500 },
    );
    expect(Date.now() - started).toBeLessThan(3500);
  });

  it("Stop all stops the workers and takes queued ones off the queue", async () => {
    const { team, viewer } = await start();
    viewer.send("settings.set", { maxSessions: 3 });
    await new Promise((r) => setTimeout(r, 100));
    await team.request(
      `${PAVILION}spawn a[pavilion/a]: work 20000 ;; b[pavilion/b]: work 20000 ;; c[pavilion/c]: work 20000`,
    );
    await waitFor(() => expect(workers(team)).toHaveLength(3));
    await team.stopAll();
    await waitFor(() => expect(team.board.every((t) => t.status === "stopped")).toBe(true), {
      timeout: 3500,
    });
    expect(team.claims.all).toHaveLength(0);
  });
});

describe("the limit on sessions", () => {
  it("workers count toward it: one over the limit waits for a free session and then starts", async () => {
    const { team, viewer } = await start();
    // Mochi and Architect are two sessions; with a limit of 3 only one worker fits.
    viewer.send("settings.set", { maxSessions: 3 });
    await new Promise((r) => setTimeout(r, 100));
    await team.request(`${PAVILION}spawn a[pavilion/a]: work 500 ;; b[pavilion/b]: work 100`);
    await waitFor(() => expect(workers(team)).toHaveLength(2));
    const [first, second] = workers(team) as [TeamTask, TeamTask];
    expect(first.status).toBe("running");
    expect(second.status).toBe("queued");
    expect(second.waitingForSession).toBe(true);
    // At no time are more sessions running than the limit.
    let most = 0;
    const timer = setInterval(() => {
      most = Math.max(most, team.sessions);
    }, 20);
    await team.settled();
    clearInterval(timer);
    expect(most).toBeLessThanOrEqual(3);
    expect(workers(team).map((w) => w.status)).toEqual(["done", "done"]);
    expect(taskOf(team, "architect.3").startedAt ?? 0).toBeGreaterThanOrEqual(
      taskOf(team, "architect.2").finishedAt ?? 1,
    );
  });

  it("is a setting that the team snapshot reports", async () => {
    const { team, viewer } = await start();
    viewer.send("settings.set", { maxSessions: 4 });
    await waitFor(() => expect(team.maxSessions).toBe(4));
    const snapshot = await viewer.waitFor("team.snapshot", (m) => m.payload.maxSessions === 4);
    expect(snapshot.payload.sessions).toBeGreaterThanOrEqual(1);
  });
});
