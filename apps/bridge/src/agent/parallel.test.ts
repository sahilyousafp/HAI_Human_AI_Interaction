import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTurn, Element, TeamTask } from "@hai/protocol";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { fakeProvider } from "../../test/fake-provider.ts";
import { connectFakeHost } from "../../test/host-client.ts";
import { connectClient } from "../../test/ws-client.ts";
import { type Bridge, createBridge } from "../server.ts";
import type { Team } from "./team.ts";

const ORIGIN = "http://localhost:5173";
const TOKEN = "parallel-test-token-0123456789";
const temp = (prefix: string) => mkdtempSync(join(tmpdir(), prefix));
let bridge: Bridge | null = null;
const sockets: WebSocket[] = [];
const clients: Client[] = [];

afterEach(async () => {
  // Tasks still working end now, rather than when the bridge gives up waiting for them.
  await (bridge?.agent as Team | null)?.stopAll();
  for (const c of clients.splice(0)) await c.close();
  for (const ws of sockets.splice(0)) ws.close();
  await bridge?.stop();
  bridge = null;
});

async function start() {
  const stateDir = temp("hai-fake-state-");
  const projectDir = join(temp("hai-parallel-"), "project");
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
  /** An MCP client holding the agent's own token (the fake CLI's own token for that agent is replaced). */
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
  return { team, viewer, scene: (bridge as Bridge).scene, mcp, address };
}

const replyOf = (turn?: AgentTurn) =>
  (turn?.events ?? [])
    .filter((e): e is Extract<typeof e, { type: "text.delta" }> => e.type === "text.delta")
    .map((e) => e.text)
    .join("");

const taskOf = (team: Team, agent: string): TeamTask => {
  const found = team.board.findLast((t) => t.agent === agent);
  if (!found) throw new Error(`no task for ${agent}`);
  return found;
};

const json = (result: { content?: unknown }) =>
  JSON.parse((result.content as Array<{ text?: string }> | undefined)?.[0]?.text ?? "null");
const textOf = (result: { content?: unknown }) =>
  (result.content as Array<{ text?: string }> | undefined)?.[0]?.text ?? "";

const column = (id: string, x: number, tags: Record<string, string> = {}): Element => ({
  id,
  name: id,
  type: "column",
  properties: {},
  position: [x, 0],
  section: [400, 400],
  height: 3000,
  tags,
});

describe("scoped hand-offs and the scheduler", () => {
  it("disjoint writers run together, each in its own session", async () => {
    const { team } = await start();
    await team.request("delegate architect[dome]: work 700 | product[hall]: work 700");
    await vi.waitFor(() => {
      expect(taskOf(team, "architect").status).toBe("running");
      expect(taskOf(team, "product").status).toBe("running");
    });
    expect(taskOf(team, "architect").scope).toEqual({ part: "dome" });
    expect(taskOf(team, "product").scope).toEqual({ part: "hall" });
    await team.settled();
  });

  it("overlapping scopes queue with the reason, Mochi is told, and the second starts when the first ends", async () => {
    const { team } = await start();
    const turn = await team.request("delegate architect[dome]: work 600 | product[dome]: work 100");
    expect(replyOf(turn)).toContain("overlaps Architect's");
    await vi.waitFor(() => expect(taskOf(team, "architect").status).toBe("running"));
    const product = taskOf(team, "product");
    expect(product.status).toBe("queued");
    expect(product.waitingFor).toBe(taskOf(team, "architect").id);
    await team.settled();
    expect(taskOf(team, "product").status).toBe("done");
    expect(taskOf(team, "product").startedAt ?? 0).toBeGreaterThanOrEqual(
      taskOf(team, "architect").finishedAt ?? 0,
    );
    expect(taskOf(team, "product").waitingFor).toBeUndefined();
  });

  it("a task with no scope takes the whole model, so a scoped one waits for it", async () => {
    const { team } = await start();
    await team.request("delegate architect: work 500 | product[hall]: work 100");
    await vi.waitFor(() => expect(taskOf(team, "architect").status).toBe("running"));
    expect(taskOf(team, "product").status).toBe("queued");
    await team.settled();
  });

  it("a task that needs the whole model is not starved by smaller tasks that overlap it", async () => {
    const { team } = await start();
    await team.request("delegate architect[dome]: work 500 | product: work 100 | climate[hall]: work 100");
    await vi.waitFor(() => expect(taskOf(team, "architect").status).toBe("running"));
    // Climate does not change the model, so it runs alongside; the unscoped Product waits for Architect.
    await vi.waitFor(() => expect(taskOf(team, "climate").status).toBe("running"));
    expect(taskOf(team, "product").status).toBe("queued");
    await team.settled();
  });

  it("readers run alongside whatever the writers' scopes are", async () => {
    const { team } = await start();
    await team.request("delegate architect: work 500 | reviewer: work 100");
    await vi.waitFor(() => expect(taskOf(team, "reviewer").status).toBe("running"));
    expect(taskOf(team, "architect").status).toBe("running");
    await team.settled();
  });

  it("with Parallel modelling off, a second writer queues even with a disjoint scope", async () => {
    const { team, viewer } = await start();
    viewer.send("settings.set", { features: { parallelModelling: false } });
    await viewer.waitFor("settings.snapshot", (m) => m.payload.features?.parallelModelling === false);
    await team.request("delegate architect[dome]: work 500 | product[hall]: work 100");
    await vi.waitFor(() => expect(taskOf(team, "architect").status).toBe("running"));
    expect(taskOf(team, "product").status).toBe("queued");
    await team.settled();
  });

  it("a stopped task frees its scope within 3 seconds and the waiting task starts", async () => {
    const { team } = await start();
    await team.request("delegate architect[dome]: work 20000 | product[dome]: work 100");
    await vi.waitFor(() => expect(taskOf(team, "architect").status).toBe("running"));
    expect(team.claims.all.map((c) => c.agent)).toEqual(["architect"]);
    team.cancel(taskOf(team, "architect").id);
    await vi.waitFor(() => expect(taskOf(team, "product").status).toBe("running"), { timeout: 3000 });
    expect(taskOf(team, "architect").status).toBe("stopped");
    expect(team.claims.all.map((c) => c.agent)).toEqual(["product"]);
    await team.settled();
    expect(team.claims.all).toEqual([]);
  });

  it("a queued task that is cancelled never holds a claim", async () => {
    const { team } = await start();
    await team.request("delegate architect: work 5000 | product: work 100");
    await vi.waitFor(() => expect(taskOf(team, "architect").status).toBe("running"));
    team.cancel(taskOf(team, "product").id);
    expect(team.claims.all.map((c) => c.agent)).toEqual(["architect"]);
    await team.stopAll();
    await team.settled();
    expect(team.claims.all).toEqual([]);
  });

  it("the shared brief and the scope reach each task, and any agent can read the brief again", async () => {
    const { team } = await start();
    await team.request(
      "delegate architect[dome]: preface | product[hall]: preface | brief grid 6 m, stone #d9c9a8",
    );
    await team.settled();
    const lines = (agent: string) => {
      const sent: unknown[] = [];
      team.hub(agent).greet((m) => sent.push(m));
      const first = sent[0] as { payload: { turns: AgentTurn[] } };
      return replyOf(first.payload.turns[0]);
    };
    for (const agent of ["architect", "product"]) {
      expect(lines(agent)).toContain("[brief] grid 6 m, stone #d9c9a8");
    }
    expect(lines("architect")).toContain('[scope] You may change the part "dome"');
    expect(taskOf(team, "product").brief).toBe("grid 6 m, stone #d9c9a8");
  });

  it("an invalid scope is refused with the reason", async () => {
    const { team, mcp } = await start();
    await team.request("hello");
    const lead = await mcp("mochi");
    const result = await lead.callTool({
      name: "delegate",
      arguments: {
        agent: "architect",
        title: "x",
        instruction: "y",
        scope: { region: { min: [10, 0], max: [0, 5] } },
      },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("min must not exceed max");
  });
});

describe("claims enforced where the model changes", () => {
  /** Two running scoped tasks, the scene seeded with an element in each part. */
  async function twoWorking() {
    const harness = await start();
    const { team, scene, mcp } = harness;
    await team.request("hello");
    scene.scene.apply("seed", [
      { op: "create", element: column("dome-1", 0, { "hai.part": "dome" }) },
      { op: "create", element: column("hall-1", 20_000, { "hai.part": "hall" }) },
      { op: "create", element: column("hall-2", 21_000, { "hai.part": "hall" }) },
    ]);
    await team.request("delegate architect[dome]: work 30000 | product[hall]: work 30000");
    await vi.waitFor(() => {
      expect(taskOf(team, "architect").status).toBe("running");
      expect(taskOf(team, "product").status).toBe("running");
    });
    return { ...harness, architect: await mcp("architect"), product: await mcp("product") };
  }

  it("a late call after the task ended is refused", async () => {
    const { team, mcp, scene } = await start();
    await team.request("delegate architect[dome]: work 100");
    await team.settled();
    scene.scene.apply("seed", [{ op: "create", element: column("dome-1", 0, { "hai.part": "dome" }) }]);
    const architect = await mcp("architect");
    const late = await architect.callTool({
      name: "request_claim",
      arguments: { scope: { ids: ["dome-1"] } },
    });
    expect(late.isError).toBe(true);
    expect(team.claims.forAgent("architect")).toBeUndefined();
  });

  it("the user overrides: the change is made, and the owning agent hears of it once at its next read", async () => {
    const { product, viewer, scene } = await twoWorking();
    viewer.send("scene.apply", {
      label: "Move column",
      ops: [{ op: "update", id: "hall-1", patch: { position: [20_500, 0] } }],
    });
    await vi.waitFor(() =>
      expect((scene.scene.doc.elements["hall-1"] as { position: number[] }).position[0]).toBe(20_500),
    );
    const read = async () =>
      json(await product.callTool({ name: "get_elements", arguments: { ids: ["hall-1", "hall-2"] } })) as {
        elements: Array<{ id: string; changedByUser?: boolean }>;
      };
    const first = await read();
    expect(first.elements.find((e) => e.id === "hall-1")?.changedByUser).toBe(true);
    expect(first.elements.find((e) => e.id === "hall-2")?.changedByUser).toBeUndefined();
    const second = await read();
    expect(second.elements.find((e) => e.id === "hall-1")?.changedByUser).toBeUndefined();
  });

  it("agents read the claims, ask for more scope, and give some back", async () => {
    const { architect, product, team } = await twoWorking();
    const seen = json(await architect.callTool({ name: "get_claims", arguments: {} })) as {
      claims: Array<{ agent: string; task: string; scope: string; elements: number; you: boolean }>;
    };
    expect(seen.claims.map((c) => [c.agent, c.scope, c.elements, c.you])).toEqual([
      ["architect", 'the part "dome"', 1, true],
      ["product", 'the part "hall"', 2, false],
    ]);

    // Nothing holds col-9, so it is granted and Architect may change it.
    bridge?.scene.scene.apply("seed", [{ op: "create", element: column("col-9", 40_000) }]);
    const asked = await architect.callTool({
      name: "request_claim",
      arguments: { scope: { ids: ["col-9"] } },
    });
    expect(asked.isError).toBeFalsy();
    expect(team.claims.forAgent("architect")?.scope).toEqual({ part: "dome", ids: ["col-9"] });
    expect(taskOf(team, "architect").scope).toEqual({ part: "dome", ids: ["col-9"] });

    // Product holds hall-1, so Architect's request is refused and names Product's task.
    const refused = await architect.callTool({
      name: "request_claim",
      arguments: { scope: { ids: ["hall-1"] } },
    });
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toContain("claimed by product's task");

    const released = await architect.callTool({ name: "release_claim", arguments: { ids: ["col-9"] } });
    expect(released.isError).toBeFalsy();
    expect(team.claims.forAgent("architect")?.scope).toEqual({ part: "dome" });
    const nothing = await product.callTool({ name: "release_claim", arguments: { part: true } });
    expect(nothing.isError).toBe(true);
    expect(textOf(nothing)).toContain("nothing");
  });
});

describe("three scoped tasks at once", () => {
  it("overlap in time, each in its own scope", async () => {
    const { team } = await start();
    await team.request("hello");
    await team.request(
      "delegate architect[dome]: work 800 | product[hall]: work 900 | climate[yard]: work 1300",
    );
    await team.settled();
    const [architect, product, climate] = ["architect", "product", "climate"].map((a) => taskOf(team, a));
    // Their working times overlap: each started before the other finished.
    expect(architect?.startedAt ?? 0).toBeLessThan(product?.finishedAt ?? 0);
    expect(product?.startedAt ?? 0).toBeLessThan(architect?.finishedAt ?? 0);
    expect(climate?.startedAt ?? 0).toBeLessThan(architect?.finishedAt ?? 0);
    expect([architect?.scope, product?.scope, climate?.scope]).toEqual([
      { part: "dome" },
      { part: "hall" },
      { part: "yard" },
    ]);
  });
});

describe("scripts in a host are checked afterwards", () => {
  const change = (id: string, name: string, tags: Record<string, string>, at = 0) => ({
    id,
    name,
    tags,
    bounds: {
      min: [at, 0, 0] as [number, number, number],
      max: [at + 1000, 1000, 1000] as [number, number, number],
    },
  });

  it("a script that stays in its scope is reported clean, and its part and claim go to the host", async () => {
    const { team, mcp, viewer, address } = await start();
    const rhino = await connectFakeHost(address, { token: TOKEN, track: sockets });
    await team.request("hello");
    await team.request("delegate architect[dome]: work 30000 | product[hall]: work 30000");
    await vi.waitFor(() => expect(taskOf(team, "product").status).toBe("running"));
    const architect = await mcp("architect");
    const call = architect.callTool({
      name: "host_run",
      arguments: { host: "rhino", code: "result = 1", title: "Add surfaces" },
    });
    const asked = await rhino.waitFor("host.run");
    expect(asked.payload).toMatchObject({
      agent: "architect",
      title: "Add surfaces",
      part: "dome",
      claim: { part: "dome" },
    });
    rhino.send("host.result", {
      id: asked.payload.id,
      ok: true,
      stdout: "",
      result: "done",
      durationMs: 5,
      changes: {
        added: [change("s-1", "Surface 1", { "hai.owner": "architect", "hai.part": "dome" })],
        changed: [change("d-1", "Dome", { "hai.part": "dome" })],
        deleted: [],
        truncated: false,
      },
    });
    const out = json(await call);
    expect(out.ok).toBe(true);
    expect(out.outsideYourClaim).toBeUndefined();
    expect(viewer.received.some((m) => m.type === "host.run.report")).toBe(false);
  });

  it("a script that strays is reported to the agent and to the user, naming the object, its claimant and what changed", async () => {
    const { team, mcp, viewer, address } = await start();
    const rhino = await connectFakeHost(address, { token: TOKEN, track: sockets });
    await team.request("hello");
    await team.request("delegate architect[dome]: work 30000 | product[hall]: work 30000");
    await vi.waitFor(() => expect(taskOf(team, "product").status).toBe("running"));
    const architect = await mcp("architect");
    const call = architect.callTool({
      name: "host_run",
      arguments: { host: "rhino", code: "result = 1", title: "Oops" },
    });
    const asked = await rhino.waitFor("host.run");
    rhino.send("host.result", {
      id: asked.payload.id,
      ok: true,
      stdout: "",
      durationMs: 5,
      changes: {
        added: [change("s-1", "Surface 1", { "hai.owner": "architect", "hai.part": "dome" })],
        changed: [change("h-1", "Hall wall", { "hai.part": "hall" }, 20_000)],
        deleted: [change("g-1", "Garden bed", {}, 90_000)],
        truncated: false,
      },
    });
    const out = json(await call);
    expect(out.outsideYourClaim).toContain('changed "Hall wall" (h-1), in product\'s task');
    expect(out.outsideYourClaim).toContain('deleted "Garden bed" (g-1)');
    expect(out.outsideYourClaim).toContain("Checked after the run");
    expect(out.outsideYourClaim).toContain("undo step in Rhino");
    const report = await viewer.waitFor("host.run.report");
    expect(report.payload).toMatchObject({
      host: "rhino",
      agent: "architect",
      title: "Oops",
      truncated: false,
    });
    expect(report.payload.strays.map((s) => [s.what, s.id])).toEqual([
      ["changed", "h-1"],
      ["deleted", "g-1"],
    ]);
    expect(report.payload.strays[0]?.holder).toContain("product's task");
  });
});

describe("a request about what is selected in a host", () => {
  it("a request knows what 'this' is: the bridge puts the described components in the request's context", async () => {
    const { viewer, address } = await start();
    const rhino = await connectFakeHost(address, { token: TOKEN, track: sockets });
    rhino.send("host.selection", { objects: [{ id: "a1", type: "Brep", layer: "Roof" }] });
    const asked = await rhino.waitFor("host.describe");
    rhino.send("host.described", {
      id: asked.payload.id,
      components: [
        {
          id: "a1",
          name: "Canopy",
          type: "Closed Brep",
          layer: "Roof",
          bounds: null,
          quantities: { volumeMm3: 3.24e10 },
          material: "Timber",
          properties: { "hai.part": "canopy" },
        },
      ],
    });
    await viewer.waitFor("host.selection", (m) => (m.payload.components?.length ?? 0) === 1);
    viewer.send("agent.send", {
      text: "make these 200 mm thinner",
      context: { references: [], selection: [], groundPoint: null },
    });
    const turn = await viewer.waitFor(
      "agent.turn",
      (m) => m.payload.request === "make these 200 mm thinner",
      10_000,
    );
    expect(turn.payload.context?.components).toEqual([
      expect.objectContaining({
        host: "rhino",
        id: "a1",
        material: "Timber",
        properties: { "hai.part": "canopy" },
      }),
    ]);
  });
});

describe("a request limited to a selection", () => {
  const limited = (ids: string[]) => ({
    references: [],
    selection: [],
    groundPoint: null,
    limitTo: { host: "rhino" as const, ids },
  });

  it("the scope follows the limit: a task handed out with no scope takes the selected ids", async () => {
    const { team } = await start();
    await team.request("hello");
    await team.request("delegate architect: work 30000", limited(["a1", "a2"]));
    await vi.waitFor(() => expect(taskOf(team, "architect").status).toBe("running"));
    expect(taskOf(team, "architect").scope).toEqual({ ids: ["a1", "a2"] });
  });

  it("a request without a limit hands out tasks as before", async () => {
    const { team } = await start();
    await team.request("hello");
    await team.request("delegate architect: work 30000");
    await vi.waitFor(() => expect(taskOf(team, "architect").status).toBe("running"));
    expect(taskOf(team, "architect").scope).toBeUndefined();
  });
});

describe("limitedScope", () => {
  it("narrows a given scope's ids to the limit, and keeps a part the lead named", async () => {
    const { limitedScope } = await import("./team.ts");
    expect(limitedScope(undefined, undefined)).toBeUndefined();
    expect(limitedScope({ part: "dome" }, undefined)).toEqual({ part: "dome" });
    expect(limitedScope(undefined, { ids: ["a1"] })).toEqual({ ids: ["a1"] });
    expect(limitedScope({ ids: ["a1", "b9"] }, { ids: ["a1", "a2"] })).toEqual({ ids: ["a1"] });
    expect(limitedScope({ ids: ["b9"] }, { ids: ["a1"] })).toEqual({ ids: ["a1"] });
    expect(limitedScope({ part: "dome" }, { ids: ["a1"] })).toEqual({ part: "dome", ids: ["a1"] });
  });
});
