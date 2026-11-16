import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent, AgentTurn, Message } from "@hai/protocol";
import { afterEach, describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import { fakeProvider } from "../../test/fake-provider.ts";
import { connectFakeHost } from "../../test/host-client.ts";
import { connectClient } from "../../test/ws-client.ts";
import { MCP_PATH } from "../mcp/mcp-endpoint.ts";
import { type Bridge, createBridge } from "../server.ts";
import { AgentHub } from "./agent-hub.ts";
import { allowedHaiTools, ensureDefaultAgents, readRoster } from "./roster.ts";

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
  const projectDir = join(temp("hai-identity-"), "project");
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
      provider: fakeProvider(temp("hai-fake-state-")),
      projectDir: () => projectDir,
      mcp: () => ({
        url: `http://127.0.0.1:${address.port}${MCP_PATH}`,
        token: tokens.issue({ agent, tools: allowedHaiTools(member) }),
      }),
      agent,
    },
    (m) => broadcast.push(m),
  );
  hubs.push(hub);
  await hub.ready;
  return { hub, viewer, scene: bridge.scene, address };
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
  /** Places an image in Rhino, a call that changes the model, with a fake Rhino connected so the host tools exist. */
  const placeImage = async (agent: string) => {
    const { hub, address } = await start(agent);
    await connectFakeHost(address, { token: TOKEN, track: sockets });
    await hub.request('tool host_place_image {"host":"rhino","image":"missing","plane":"top"}');
    return replyOf(lastTurn(hub));
  };

  it("reviewer cannot change the model: the call is refused by the bridge, as a tool it does not have", async () => {
    expect(await placeImage("reviewer")).toMatch(/^Refused: .*host_place_image.*not found/i);
  });

  it("architect has the tools that change the model with its own token", async () => {
    // The tool is there: it answers for itself (there is no such image), and is not unknown.
    const reply = await placeImage("architect");
    expect(reply).not.toMatch(/not found/i);
    expect(reply.length).toBeGreaterThan(0);
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
