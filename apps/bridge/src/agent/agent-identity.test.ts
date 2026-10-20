import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent, AgentTurn, Message } from "@aex/protocol";
import { afterEach, describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import { fakeProvider } from "../../test/fake-provider.ts";
import { connectClient } from "../../test/ws-client.ts";
import { MCP_PATH } from "../mcp/mcp-endpoint.ts";
import { type Bridge, createBridge } from "../server.ts";
import { AgentHub } from "./agent-hub.ts";
import { allowedAexTools, ensureDefaultAgents, readRoster } from "./roster.ts";

const ORIGIN = "http://localhost:5173";
const TOKEN = "identity-test-token-0123456789";
const temp = (prefix: string) => mkdtempSync(join(tmpdir(), prefix));
let bridge: Bridge | null = null;
const hubs: AgentHub[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const hub of hubs.splice(0)) await hub.close();
  for (const ws of sockets.splice(0)) ws.close();
  await bridge?.stop();
  bridge = null;
});

/** A bridge, and a hub running the named agent of the project's default team with its own MCP token. */
async function start(agent: string) {
  const projectDir = join(temp("aex-identity-"), "project");
  bridge = createBridge({
    host: "127.0.0.1",
    port: 0,
    allowedOrigins: [ORIGIN],
    version: "t",
    token: TOKEN,
    scene: { projectDir, saveDelayMs: 50 },
  });
  const address: AddressInfo = await bridge.start();
  const viewer = await connectClient(address, { token: TOKEN, origin: ORIGIN, track: sockets });
  ensureDefaultAgents(projectDir);
  const member = readRoster(projectDir).find((m) => m.name === agent);
  if (!member) throw new Error(`no ${agent}`);
  const tokens = bridge.agentTokens;
  const broadcast: Message[] = [];
  const hub = new AgentHub(
    {
      provider: fakeProvider(temp("aex-fake-state-")),
      projectDir: () => projectDir,
      mcp: () => ({
        url: `http://127.0.0.1:${address.port}${MCP_PATH}`,
        token: tokens.issue({ agent, tools: allowedAexTools(member) }),
      }),
      agent,
    },
    (m) => broadcast.push(m),
  );
  hubs.push(hub);
  await hub.ready;
  return { hub, viewer, scene: bridge.scene };
}

const replyOf = (turn?: AgentTurn) =>
  (turn?.events ?? [])
    .filter((e): e is Extract<AgentEvent, { type: "text.delta" }> => e.type === "text.delta")
    .map((e) => e.text)
    .join("");

function lastTurn(hub: AgentHub): AgentTurn | undefined {
  const sent: Message[] = [];
  hub.greet((m) => sent.push(m));
  const transcript = sent[0];
  return transcript?.type === "agent.transcript" ? transcript.payload.turns.at(-1) : undefined;
}

describe("each agent is known by its own token", () => {
  it("reviewer cannot edit: its write call is refused by the bridge and the model is unchanged", async () => {
    const { hub, scene } = await start("reviewer");
    const before = structuredClone(scene.scene.doc);
    await hub.request("column");
    expect(replyOf(lastTurn(hub))).toMatch(/^That failed: .*create_elements/);
    expect(scene.scene.doc).toEqual(before);
  });

  it("architect can edit with its own token", async () => {
    const { hub, scene } = await start("architect");
    await hub.request("column");
    expect(replyOf(lastTurn(hub))).toBe("Added a column.");
    expect(Object.values(scene.scene.doc.elements).some((e) => e.name === "Fake column")).toBe(true);
  });

  it("an approval card names the agent asking", async () => {
    const { hub, viewer } = await start("reviewer");
    const turn = hub.request("shell: echo hi");
    const card = await viewer.waitFor("approval.pending");
    expect(card.payload).toMatchObject({ tool: "Bash", agent: "reviewer" });
    viewer.send("approval.decide", { id: card.payload.id, decision: "deny" });
    await turn;
  });
});
