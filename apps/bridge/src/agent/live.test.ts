// Runs against the real, signed-in Claude Code CLI, so it is manual: CI skips it. Run it with
//   HAI_LIVE_CLAUDE=1 pnpm vitest run apps/bridge/src/agent/live.test.ts
// It uses a few short requests on the maintainer's own plan.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeCliProvider } from "@hai/agent-core";
import type { AgentEvent, AgentTurn, Message } from "@hai/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { type Bridge, createBridge } from "../server.ts";
import type { Team } from "./team.ts";

const live = process.env.HAI_LIVE_CLAUDE === "1";

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

describe.skipIf(!live)("with the real Claude Code CLI (manual)", () => {
  let bridge: Bridge | null = null;
  afterEach(async () => {
    await bridge?.stop();
    bridge = null;
  });

  async function start(): Promise<{ bridge: Bridge; team: Team }> {
    bridge = createBridge({
      host: "127.0.0.1",
      port: 0,
      allowedOrigins: ["http://localhost:5173"],
      version: "live",
      scene: { projectDir: join(mkdtempSync(join(tmpdir(), "hai-live-")), "project"), saveDelayMs: 50 },
      agent: { provider: new ClaudeCliProvider() },
    });
    await bridge.start();
    const team = bridge.agent as Team;
    await team.ready;
    expect(team.currentStatus.state).toBe("idle");
    return { bridge, team };
  }

  it("units honoured: a wall 3 m high is created with a height of 3000", { timeout: 300_000 }, async () => {
    const { bridge, team } = await start();
    const before = new Set(Object.keys(bridge.scene.scene.doc.elements));
    await team.request(
      'Add one wall named "Live check wall" on level L0, 3 m high and 200 mm thick, from (0, 30000) to (6000, 30000). Do not change anything else.',
    );
    await team.settled();
    const added = Object.values(bridge.scene.scene.doc.elements).filter((e) => !before.has(e.id));
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ type: "wall", height: 3000, thickness: 200 });
  });

  it("Mochi on Sonnet hands a request to Architect, answers a status question while it works, and reports back", {
    timeout: 600_000,
  }, async () => {
    const { bridge, team } = await start();
    const before = new Set(Object.keys(bridge.scene.scene.doc.elements));
    await team.request(
      'Architect, add four columns named "Live column 1" to "Live column 4" on level L0, 400 by 400 mm and 3 m high, at (0, -8000), (4000, -8000), (8000, -8000) and (12000, -8000).',
    );
    // Mochi's turn ended at the hand-off; Architect has the task.
    expect(team.board).toEqual([expect.objectContaining({ agent: "architect" })]);
    const init = transcript(team, "mochi")[0]?.events.find((e) => e.type === "init");
    expect(init?.type === "init" && init.model).toMatch(/sonnet/i);

    const status = await team.request("Mochi, what is everyone doing?");
    expect(replyOf(status)).toMatch(/architect/i);

    await team.settled();
    const turns = transcript(team, "mochi");
    expect(turns.at(-1)?.kind).toBe("digest");
    expect(replyOf(turns.at(-1)).length).toBeGreaterThan(0);
    const columns = Object.values(bridge.scene.scene.doc.elements).filter(
      (e) => !before.has(e.id) && e.name.startsWith("Live column"),
    );
    expect(columns).toHaveLength(4);
    console.log(
      "live team check:",
      JSON.stringify({
        mochiModel: init?.type === "init" ? init.model : null,
        status: replyOf(status),
        report: replyOf(turns.at(-1)),
      }),
    );
  });
});
