import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Detection } from "@hai/agent-core";
import type { AgentEvent, AgentTurn, Message } from "@hai/protocol";
import { describe, expect, it, vi } from "vitest";
import { fakeProvider, DETECTED as OK } from "../../test/fake-provider.ts";
import { agentDir, migrateSessionToLead, readSessionId, writeSessionId } from "./agent-config.ts";
import { AgentHub } from "./agent-hub.ts";

const temp = (prefix: string) => mkdtempSync(join(tmpdir(), prefix));

function setup(detection: Detection = OK, agent?: string) {
  const stateDir = temp("hai-fake-state-");
  let projectDir = temp("hai-agent-project-");
  const messages: Message[] = [];
  const hub = new AgentHub(
    {
      provider: fakeProvider(stateDir, detection),
      projectDir: () => projectDir,
      mcp: () => ({ url: "http://127.0.0.1:4870/mcp", token: "test-token-0123456789" }),
      ...(agent ? { agent } : {}),
    },
    (m) => messages.push(m),
  );
  const starts = () =>
    readdirSync(stateDir)
      .filter((f) => f.startsWith("start-"))
      .map(
        (f) =>
          JSON.parse(readFileSync(join(stateDir, f), "utf8")) as { pid: number; args: string[]; cwd: string },
      );
  /** Every request text the fake CLI received, in order (its conversation history). */
  const received = () =>
    readdirSync(stateDir)
      .filter((f) => !f.startsWith("start-") && f.endsWith(".json"))
      .flatMap((f) => JSON.parse(readFileSync(join(stateDir, f), "utf8")) as string[]);
  return {
    hub,
    messages,
    starts,
    received,
    projectDir: () => projectDir,
    switchProject: () => {
      projectDir = temp("hai-agent-project-");
    },
  };
}

const replyOf = (turn?: AgentTurn) =>
  (turn?.events ?? [])
    .filter((e): e is Extract<AgentEvent, { type: "text.delta" }> => e.type === "text.delta")
    .map((e) => e.text)
    .join("");

/** What a newly connected (or reloaded) client is sent. */
function transcriptOf(hub: AgentHub): AgentTurn[] {
  const sent: Message[] = [];
  hub.greet((m) => sent.push(m));
  const t = sent[0];
  if (t?.type !== "agent.transcript") throw new Error("no transcript");
  return t.payload.turns;
}

// Every agent of the team runs the same session behaviour, so each case runs for the unnamed session and for one
// named agent.
describe.each([{ agent: undefined }, { agent: "architect" }])(
  "AgentHub ($agent) with a fake Claude Code CLI",
  ({ agent }) => {
    it("second turn reuses the process, and can refer to the first", async () => {
      const { hub, starts } = setup(OK, agent);
      await hub.ready;
      await hub.request("hello");
      await hub.request("and again");
      const [first, second] = transcriptOf(hub);
      const pid = (turn?: AgentTurn) => replyOf(turn).match(/pid=(\d+)/)?.[1];
      expect(pid(first)).toBeDefined();
      expect(pid(second)).toBe(pid(first));
      expect(replyOf(second)).toContain("previous=hello");
      expect(starts()).toHaveLength(1);
      await hub.close();
    });

    it("browser reload: a new client gets both turns, and the next request continues the conversation", async () => {
      const { hub } = setup(OK, agent);
      await hub.ready;
      await hub.request("first");
      await hub.request("second");
      const turns = transcriptOf(hub);
      expect(turns.map((t) => t.request)).toEqual(["first", "second"]);
      expect(turns.every((t) => t.events.at(-1)?.type === "turn.end")).toBe(true);
      await hub.request("third");
      expect(replyOf(transcriptOf(hub)[2])).toContain("previous=second");
      await hub.close();
    });

    it("agent process crash: the next request resumes the same conversation and is marked recovered", async () => {
      const { hub, starts } = setup(OK, agent);
      await hub.ready;
      await hub.request("hello");
      await hub.request("crash");
      const crashed = transcriptOf(hub)[1];
      expect(crashed?.events.map((e) => e.type)).toContain("error");
      expect(crashed?.events.at(-1)).toMatchObject({ type: "turn.end", reason: "error" });
      await hub.request("after the crash");
      const recovered = transcriptOf(hub)[2];
      expect(recovered?.recovered).toBe(true);
      expect(replyOf(recovered)).toContain("previous=hello");
      const all = starts();
      expect(all).toHaveLength(2);
      expect(all.filter((s) => s.args.includes("--resume"))).toHaveLength(1);
      await hub.close();
    });

    it("stop mid-turn: the turn ends as stopped within 3 s and the session takes the next request", async () => {
      const { hub, starts } = setup(OK, agent);
      await hub.ready;
      const running = hub.request("slow");
      await new Promise((r) => setTimeout(r, 600));
      const stoppedAt = Date.now();
      await hub.stop();
      await running;
      expect(Date.now() - stoppedAt).toBeLessThan(3000);
      const turn = transcriptOf(hub)[0];
      expect(turn?.events.at(-1)).toMatchObject({ type: "turn.end", reason: "stopped" });
      expect(turn?.events.some((e) => e.type === "error")).toBe(false);
      await hub.request("next");
      expect(transcriptOf(hub)[1]?.events.at(-1)).toMatchObject({ type: "turn.end", reason: "done" });
      expect(starts()).toHaveLength(1); // the interrupt kept the process
      await hub.close();
    });

    it("stop when the process ignores the interrupt: it is ended within 3 s and the next request resumes", async () => {
      const { hub, starts } = setup(OK, agent);
      await hub.ready;
      await hub.request("hello");
      const running = hub.request("stubborn");
      await new Promise((r) => setTimeout(r, 400));
      const stoppedAt = Date.now();
      await hub.stop();
      await running;
      expect(Date.now() - stoppedAt).toBeLessThan(3000);
      expect(transcriptOf(hub)[1]?.events.at(-1)).toMatchObject({ type: "turn.end", reason: "stopped" });
      await hub.request("after");
      const after = transcriptOf(hub)[2];
      expect(after?.recovered).toBe(false); // a stop is not a crash
      expect(replyOf(after)).toContain("previous=stubborn");
      expect(starts().filter((s) => s.args.includes("--resume"))).toHaveLength(1);
      await hub.close();
    });

    it("starts claude in the project folder with the scene MCP config, permission tool and system prompt", async () => {
      const { hub, starts, projectDir } = setup(OK, agent);
      await hub.ready;
      await hub.request("hello");
      const [start] = starts();
      expect(start?.cwd).toBe(projectDir());
      const flag = (name: string) => {
        const i = start?.args.indexOf(name) ?? -1;
        return i >= 0 ? start?.args[i + 1] : undefined;
      };
      expect(flag("--permission-prompt-tool")).toBe("mcp__hai__approve_tool");
      const mcp = JSON.parse(readFileSync(flag("--mcp-config") ?? "", "utf8"));
      expect(mcp.mcpServers.hai).toEqual({
        type: "http",
        url: "http://127.0.0.1:4870/mcp",
        headers: { Authorization: "Bearer test-token-0123456789" },
      });
      const prompt = readFileSync(flag("--append-system-prompt-file") ?? "", "utf8");
      expect(prompt).toMatch(/millimetres/);
      expect(prompt).toMatch(/Z is up/);
      expect(readFileSync(join(projectDir(), ".hai", ".gitignore"), "utf8")).toBe("*\n");
      expect(start?.args).not.toContain("--bare");
      expect(start?.args).not.toContain("--strict-mcp-config");
      expect(flag("--agent")).toBe(agent);
      expect(flag("--mcp-config")).toBe(join(agentDir(projectDir(), agent), "mcp.json"));
      expect(replyOf(transcriptOf(hub)[0])).toContain(`agent=${agent ?? "default"}`);
      await hub.close();
    });

    it("another project gets its own process and conversation", async () => {
      const { hub, starts, switchProject } = setup(OK, agent);
      await hub.ready;
      await hub.request("in project one");
      switchProject();
      await hub.request("in project two");
      expect(replyOf(transcriptOf(hub)[1])).toContain("previous=none");
      expect(starts()).toHaveLength(2);
      await hub.close();
    });

    it("CLI missing: the status says so with the fix, and requests are refused", async () => {
      const { hub, messages } = setup(
        {
          ok: false,
          reason: "missing",
          message: "Claude Code is not installed.",
          fix: "Install it.",
        },
        agent,
      );
      await hub.ready;
      expect(hub.currentStatus).toEqual({
        state: "unavailable",
        reason: "Claude Code is not installed.",
        fix: "Install it.",
      });
      expect(
        messages.some((m) => m.type === "agent.status" && m.payload.status.state === "unavailable"),
      ).toBe(true);
      await expect(hub.request("hello")).rejects.toThrow(/not installed/);
    });

    it("installed after the bridge started: a page reload checks again and the agent becomes ready", async () => {
      let detection: Detection = {
        ok: false,
        reason: "missing",
        message: "Claude Code is not installed.",
        fix: "x",
      };
      const provider = fakeProvider(temp("hai-fake-state-"));
      const projectDir = temp("hai-agent-project-");
      const hub = new AgentHub(
        {
          provider: {
            id: provider.id,
            label: provider.label,
            start: (options) => provider.start(options),
            detect: async () => detection,
          },
          projectDir: () => projectDir,
          mcp: () => ({ url: "http://127.0.0.1:4870/mcp", token: "test-token-0123456789" }),
          ...(agent ? { agent } : {}),
        },
        () => {},
      );
      await hub.ready;
      expect(hub.currentStatus.state).toBe("unavailable");
      detection = OK; // the user installs and signs in, then reloads the page
      hub.greet(() => {});
      await vi.waitFor(() => expect(hub.currentStatus.state).toBe("idle"));
      await hub.request("hello");
      await hub.close();
    });

    it('"make this 300 thick": the agent receives the transcript with the pointed wall as the first reference', async () => {
      const { hub, received } = setup(OK, agent);
      await hub.ready;
      await hub.request("make this 300 thick", {
        references: [{ id: "wall-n", type: "wall", name: "North wall" }],
        selection: [],
        groundPoint: [12_400.4, 3100, 0],
      });
      expect(received().at(-1)).toBe(
        '[context] references: 1) wall wall-n "North wall"; selection: none; ground point: 12400, 3100, 0 mm\nmake this 300 thick',
      );
      // The transcript, not the block, is what the panel shows.
      expect(transcriptOf(hub).at(-1)).toMatchObject({ request: "make this 300 thick" });
      await hub.close();
    });

    it("select first, then speak: the selected slabs are the references", async () => {
      const { hub, received } = setup(OK, agent);
      await hub.ready;
      const slabs = ["slab-0", "slab-1", "slab-2"];
      await hub.request("make these 250 thick", {
        references: slabs.map((id) => ({ id, type: "slab", name: id })),
        selection: slabs,
        groundPoint: null,
      });
      expect(received().at(-1)).toBe(
        '[context] references: 1) slab slab-0 "slab-0", 2) slab slab-1 "slab-1", 3) slab slab-2 "slab-2"; selection: slab-0, slab-1, slab-2; ground point: none\nmake these 250 thick',
      );
      await hub.close();
    });

    it("a typed request reaches the agent unchanged", async () => {
      const { hub, received } = setup(OK, agent);
      await hub.ready;
      await hub.request("hello");
      expect(received().at(-1)).toBe("hello");
      await hub.close();
    });
  },
);

describe("a team in one project", () => {
  it("each agent keeps its own conversation, session file and name on what it broadcasts", async () => {
    const stateDir = temp("hai-fake-state-");
    const projectDir = temp("hai-agent-project-");
    const messages: Message[] = [];
    const hub = (agent: string, extraPrompt?: string) =>
      new AgentHub(
        {
          provider: fakeProvider(stateDir),
          projectDir: () => projectDir,
          mcp: () => ({ url: "http://127.0.0.1:4870/mcp", token: `token-${agent}-0123456789` }),
          agent,
          extraPrompt: () => extraPrompt,
        },
        (m) => messages.push(m),
      );
    const mochi = hub("mochi", "Your team: architect.");
    const architect = hub("architect");
    await Promise.all([mochi.ready, architect.ready]);
    await Promise.all([mochi.request("status?"), architect.request("add a stair core")]);
    await architect.request("and a second one");
    expect(replyOf(transcriptOf(mochi)[0])).toMatch(/agent=mochi .*previous=none/);
    expect(replyOf(transcriptOf(architect)[1])).toMatch(/agent=architect .*previous=add a stair core/);
    const mochiSession = readSessionId(projectDir, "mochi");
    expect(mochiSession).toBeDefined();
    expect(readSessionId(projectDir, "architect")).not.toBe(mochiSession);
    expect(readSessionId(projectDir)).toBeUndefined(); // no unnamed session any more
    // Each process gets its own MCP config, and only the lead gets the roster.
    const files = (agent: string) => ({
      mcp: readFileSync(join(agentDir(projectDir, agent), "mcp.json"), "utf8"),
      prompt: readFileSync(join(agentDir(projectDir, agent), "system.md"), "utf8"),
    });
    expect(files("mochi").mcp).toContain("token-mochi-");
    expect(files("architect").mcp).toContain("token-architect-");
    expect(files("mochi").prompt).toContain("Your team: architect.");
    expect(files("architect").prompt).not.toContain("Your team");
    // Every broadcast says which agent it is about.
    const tagged = messages.filter((m) => m.type.startsWith("agent."));
    expect(tagged.length).toBeGreaterThan(0);
    expect(
      tagged.every(
        (m) => "agent" in m.payload && (m.payload.agent === "mochi" || m.payload.agent === "architect"),
      ),
    ).toBe(true);
    await Promise.all([mochi.close(), architect.close()]);
  });

  it("an earlier conversation continues with the lead", async () => {
    const projectDir = temp("hai-agent-project-");
    writeSessionId(projectDir, "earlier-session");
    migrateSessionToLead(projectDir, "mochi");
    expect(readSessionId(projectDir, "mochi")).toBe("earlier-session");
    expect(readSessionId(projectDir)).toBeUndefined();
    // Once the lead has a conversation of its own, an unnamed one never replaces it.
    writeSessionId(projectDir, "stale");
    migrateSessionToLead(projectDir, "mochi");
    expect(readSessionId(projectDir, "mochi")).toBe("earlier-session");
  });

  it("a resumed lead picks up the migrated conversation", async () => {
    const stateDir = temp("hai-fake-state-");
    const projectDir = temp("hai-agent-project-");
    const options = {
      provider: fakeProvider(stateDir),
      projectDir: () => projectDir,
      mcp: () => ({ url: "http://127.0.0.1:4870/mcp", token: "test-token-0123456789" }),
    };
    const before = new AgentHub(options, () => {});
    await before.ready;
    await before.request("before the team");
    await before.close();
    migrateSessionToLead(projectDir, "mochi");
    const mochi = new AgentHub({ ...options, agent: "mochi" }, () => {});
    await mochi.ready;
    await mochi.request("hello mochi");
    expect(replyOf(transcriptOf(mochi)[0])).toContain("previous=before the team");
    await mochi.close();
  });
});
