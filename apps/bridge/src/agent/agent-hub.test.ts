import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Detection } from "@aex/agent-core";
import type { AgentEvent, AgentTurn, Message } from "@aex/protocol";
import { describe, expect, it, vi } from "vitest";
import { fakeProvider, DETECTED as OK } from "../../test/fake-provider.ts";
import { AgentHub } from "./agent-hub.ts";

const temp = (prefix: string) => mkdtempSync(join(tmpdir(), prefix));

function setup(detection: Detection = OK) {
  const stateDir = temp("aex-fake-state-");
  let projectDir = temp("aex-agent-project-");
  const messages: Message[] = [];
  const hub = new AgentHub(
    {
      provider: fakeProvider(stateDir, detection),
      projectDir: () => projectDir,
      mcp: () => ({ url: "http://127.0.0.1:4870/mcp", token: "test-token-0123456789" }),
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
  return {
    hub,
    messages,
    starts,
    projectDir: () => projectDir,
    switchProject: () => {
      projectDir = temp("aex-agent-project-");
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

describe("AgentHub with a fake Claude Code CLI", () => {
  it("second turn reuses the process, and can refer to the first", async () => {
    const { hub, starts } = setup();
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
    const { hub } = setup();
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
    const { hub, starts } = setup();
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
    const { hub, starts } = setup();
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
    const { hub, starts } = setup();
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
    const { hub, starts, projectDir } = setup();
    await hub.ready;
    await hub.request("hello");
    const [start] = starts();
    expect(start?.cwd).toBe(projectDir());
    const flag = (name: string) => start?.args[(start?.args.indexOf(name) ?? -2) + 1];
    expect(flag("--permission-prompt-tool")).toBe("mcp__aex__approve_tool");
    const mcp = JSON.parse(readFileSync(flag("--mcp-config") ?? "", "utf8"));
    expect(mcp.mcpServers.aex).toEqual({
      type: "http",
      url: "http://127.0.0.1:4870/mcp",
      headers: { Authorization: "Bearer test-token-0123456789" },
    });
    const prompt = readFileSync(flag("--append-system-prompt-file") ?? "", "utf8");
    expect(prompt).toMatch(/millimetres/);
    expect(prompt).toMatch(/Z is up/);
    expect(readFileSync(join(projectDir(), ".aex", ".gitignore"), "utf8")).toBe("*\n");
    expect(start?.args).not.toContain("--bare");
    expect(start?.args).not.toContain("--strict-mcp-config");
    await hub.close();
  });

  it("another project gets its own process and conversation", async () => {
    const { hub, starts, switchProject } = setup();
    await hub.ready;
    await hub.request("in project one");
    switchProject();
    await hub.request("in project two");
    expect(replyOf(transcriptOf(hub)[1])).toContain("previous=none");
    expect(starts()).toHaveLength(2);
    await hub.close();
  });

  it("CLI missing: the status says so with the fix, and requests are refused", async () => {
    const { hub, messages } = setup({
      ok: false,
      reason: "missing",
      message: "Claude Code is not installed.",
      fix: "Install it.",
    });
    await hub.ready;
    expect(hub.currentStatus).toEqual({
      state: "unavailable",
      reason: "Claude Code is not installed.",
      fix: "Install it.",
    });
    expect(messages.some((m) => m.type === "agent.status" && m.payload.status.state === "unavailable")).toBe(
      true,
    );
    await expect(hub.request("hello")).rejects.toThrow(/not installed/);
  });

  it("installed after the bridge started: a page reload checks again and the agent becomes ready", async () => {
    let detection: Detection = {
      ok: false,
      reason: "missing",
      message: "Claude Code is not installed.",
      fix: "x",
    };
    const provider = fakeProvider(temp("aex-fake-state-"));
    const projectDir = temp("aex-agent-project-");
    const hub = new AgentHub(
      {
        provider: { ...provider, detect: async () => detection },
        projectDir: () => projectDir,
        mcp: () => ({ url: "http://127.0.0.1:4870/mcp", token: "test-token-0123456789" }),
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
});
