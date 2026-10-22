import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent, Message } from "@hai/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { fakeProvider } from "../../test/fake-provider.ts";
import { connectClient } from "../../test/ws-client.ts";
import { type Bridge, createBridge } from "../server.ts";
import { ExtensionHub, parseSkill, readProjectServers, skillsDir } from "./extensions.ts";

const temp = (prefix: string) => mkdtempSync(join(tmpdir(), prefix));

function skillFolder(name: string, manifest?: string): string {
  const dir = join(temp("hai-skill-src-"), name);
  mkdirSync(dir, { recursive: true });
  if (manifest !== undefined) writeFileSync(join(dir, "SKILL.md"), manifest);
  writeFileSync(join(dir, "notes.md"), "Extra file that comes along.\n");
  return dir;
}
const MANIFEST =
  "---\nname: zoning-check\ndescription: Checks massing against the zoning envelope.\n---\n\nSteps.\n";

describe("parseSkill", () => {
  it("reads name and description, including folded and quoted values", () => {
    expect(parseSkill(MANIFEST)).toEqual({
      name: "zoning-check",
      description: "Checks massing against the zoning envelope.",
    });
    expect(parseSkill('---\nname: "a-b"\ndescription: >\n  First line\n  second line\n---\n')).toEqual({
      name: "a-b",
      description: "First line second line",
    });
  });

  it("explains what is missing", () => {
    expect(parseSkill("# No front matter")).toMatchObject({ error: /front matter/ });
    expect(parseSkill("---\ndescription: x\n---\n")).toMatchObject({ error: /no name/ });
    expect(parseSkill("---\nname: x\n---\n")).toMatchObject({ error: /no description/ });
    expect(parseSkill("---\nname: ../evil\ndescription: x\n---\n")).toMatchObject({
      error: /letters, digits/,
    });
  });
});

describe("readProjectServers", () => {
  it("lists servers with env and header names but never their values", () => {
    const dir = temp("hai-mcpjson-");
    writeFileSync(
      join(dir, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          files: { type: "stdio", command: "npx", args: ["files-mcp"], env: { API_KEY: "s3cret" } },
          tracker: {
            type: "http",
            url: "https://mcp.example.com/mcp",
            headers: { Authorization: "Bearer abc" },
          },
        },
      }),
    );
    const servers = readProjectServers(dir);
    expect(servers).toEqual([
      { name: "files", transport: "stdio", target: "npx files-mcp", envKeys: ["API_KEY"], headerKeys: [] },
      {
        name: "tracker",
        transport: "http",
        target: "https://mcp.example.com/mcp",
        envKeys: [],
        headerKeys: ["Authorization"],
      },
    ]);
    expect(JSON.stringify(servers)).not.toMatch(/s3cret|Bearer abc/);
  });
});

describe("install from a git URL", () => {
  it("clones shallowly, validates and copies without the .git folder", async () => {
    const projectDir = temp("hai-git-project-");
    const sent: Message[] = [];
    const hub = new ExtensionHub(
      {
        projectDir: () => projectDir,
        provider: null,
        restart: async () => {},
        // A stand-in for git: "clones" by writing a skill (and a .git folder) into the target.
        run: async (_command, args) => {
          const target = args.at(-1) ?? "";
          mkdirSync(join(target, ".git"), { recursive: true });
          writeFileSync(join(target, "SKILL.md"), MANIFEST);
          expect(args.slice(0, 3)).toEqual(["clone", "--depth", "1"]);
          return { code: 0, stdout: "", stderr: "" };
        },
      },
      (m) => sent.push(m),
    );
    hub.handle(
      {
        type: "extensions.installSkill",
        id: "i",
        payload: { source: "https://example.com/skills/zoning.git" },
      },
      (m) => sent.push(m),
    );
    await vi.waitFor(() => expect(sent.some((m) => m.type === "extensions.snapshot")).toBe(true));
    expect(readdirSync(join(skillsDir(projectDir), "zoning-check"))).toEqual(["SKILL.md"]);
  });
});

describe("extensions with the fake Claude Code CLI", () => {
  const ORIGIN = "http://localhost:5173";
  const TOKEN = "extensions-test-token-0123456789";
  let bridge: Bridge | null = null;
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const ws of sockets.splice(0)) ws.close();
    await bridge?.stop();
    bridge = null;
  });

  async function start(prepare?: (projectDir: string) => void) {
    const projectDir = join(temp("hai-ext-it-"), "project");
    mkdirSync(projectDir, { recursive: true });
    prepare?.(projectDir);
    bridge = createBridge({
      host: "127.0.0.1",
      port: 0,
      allowedOrigins: [ORIGIN],
      version: "t",
      token: TOKEN,
      scene: { projectDir, saveDelayMs: 50 },
      agent: { provider: fakeProvider(temp("hai-fake-state-")) },
    });
    const address: AddressInfo = await bridge.start();
    await bridge.agent?.ready;
    const viewer = await connectClient(address, { token: TOKEN, origin: ORIGIN, track: sockets });
    const agent = bridge.agent;
    if (!agent) throw new Error("no agent");
    const snapshots = () => viewer.received.filter((m) => m.type === "extensions.snapshot");
    const latest = () => snapshots().at(-1)?.payload;
    const change = async (type: string, payload: unknown) => {
      const before = snapshots().length;
      viewer.send(type, payload);
      await viewer.waitFor(
        "extensions.snapshot",
        (m) => snapshots().indexOf(m) >= before && Boolean(m.payload.notice),
      );
    };
    return { projectDir, viewer, agent, latest, change };
  }

  const replyOf = (received: Message[]) => {
    const turnId = received.filter((m) => m.type === "agent.turn").at(-1)?.payload.id;
    return received
      .flatMap((m) => (m.type === "agent.event" && m.payload.turnId === turnId ? [m.payload.event] : []))
      .filter((e): e is Extract<AgentEvent, { type: "text.delta" }> => e.type === "text.delta")
      .map((e) => e.text)
      .join("");
  };

  it("failed server is shown: listed as failed, with its scope", async () => {
    const { agent, latest } = await start((dir) =>
      writeFileSync(
        join(dir, ".mcp.json"),
        JSON.stringify({
          mcpServers: { "broken-db": { type: "stdio", command: "nope", args: [], env: {} } },
        }),
      ),
    );
    expect(latest()?.loaded).toBeNull(); // nothing loaded before the agent first runs
    await agent.request("hello");
    await vi.waitFor(() =>
      expect(latest()?.loaded?.servers).toContainEqual({
        name: "broken-db",
        status: "failed",
        scope: "project",
      }),
    );
  });

  it("add a stdio server: it is in the project config and, after the restart, in the loaded list", async () => {
    const { projectDir, agent, latest, change } = await start();
    await change("extensions.addServer", {
      server: { transport: "stdio", name: "files", command: "npx", args: ["-y", "files-mcp"], env: {} },
    });
    expect(latest()?.notice).toMatch(/Added the MCP server files/);
    expect(JSON.parse(readFileSync(join(projectDir, ".mcp.json"), "utf8")).mcpServers.files).toMatchObject({
      command: "npx",
      args: ["-y", "files-mcp"],
    });
    expect(latest()?.projectServers.map((s) => s.name)).toEqual(["files"]);
    await agent.request("hello");
    await vi.waitFor(() => expect(latest()?.loaded?.servers.map((s) => s.name)).toContain("files"));
  });

  it("remove a server: gone from the project config and, after the restart, from the loaded list", async () => {
    const { projectDir, agent, latest, change } = await start();
    await change("extensions.addServer", {
      server: { transport: "stdio", name: "files", command: "npx", args: [], env: {} },
    });
    await agent.request("hello");
    await change("extensions.removeServer", { name: "files" });
    expect(JSON.parse(readFileSync(join(projectDir, ".mcp.json"), "utf8")).mcpServers).toEqual({});
    expect(latest()?.projectServers).toEqual([]);
    await agent.request("again");
    await vi.waitFor(() => expect(latest()?.loaded?.servers.map((s) => s.name)).not.toContain("files"));
  });

  it("masked header: the view shows the header name only, and no message or log contains the value", async () => {
    const logged: string[] = [];
    for (const method of ["log", "info", "warn", "error"] as const)
      vi.spyOn(console, method).mockImplementation((...args) => void logged.push(args.join(" ")));
    const { viewer, latest, change } = await start();
    const secret = "Bearer sk-live-do-not-leak-4242";
    await change("extensions.addServer", {
      server: {
        transport: "http",
        name: "tracker",
        url: "https://mcp.example.com/mcp",
        headers: { Authorization: secret },
      },
    });
    expect(latest()?.projectServers).toEqual([
      {
        name: "tracker",
        transport: "http",
        target: "https://mcp.example.com/mcp",
        envKeys: [],
        headerKeys: ["Authorization"],
      },
    ]);
    expect(JSON.stringify(viewer.received)).not.toContain("sk-live-do-not-leak");
    expect(logged.join("\n")).not.toContain("sk-live-do-not-leak");
  });

  it("install from folder: copied into the project's skills and, after the restart, in the skill list", async () => {
    const { projectDir, agent, latest, change } = await start();
    await change("extensions.installSkill", { source: skillFolder("zoning", MANIFEST) });
    expect(readdirSync(join(skillsDir(projectDir), "zoning-check")).sort()).toEqual(["SKILL.md", "notes.md"]);
    expect(latest()?.projectSkills).toEqual([
      { name: "zoning-check", description: "Checks massing against the zoning envelope.", scope: "project" },
    ]);
    await agent.request("hello");
    await vi.waitFor(() => expect(latest()?.loaded?.skills.map((s) => s.name)).toContain("zoning-check"));
  });

  it("invalid skill rejected: no SKILL.md, a reason, and nothing copied", async () => {
    const { projectDir, viewer } = await start();
    viewer.send("extensions.installSkill", { source: skillFolder("empty") }, "install-1");
    const error = await viewer.waitFor("request.error", (m) => m.payload.requestId === "install-1");
    expect(error.payload.message).toMatch(/SKILL\.md is missing/);
    expect(existsSync(skillsDir(projectDir))).toBe(false);
  });

  it("conversation continues after adding a server, in a new process that has the server", async () => {
    const { viewer, agent, latest, change } = await start();
    await agent.request("first request");
    const first = await viewer.waitFor("agent.turn", (m) => m.payload.request === "first request");
    await viewer.waitFor(
      "agent.event",
      (m) => m.payload.turnId === first.payload.id && m.payload.event.type === "turn.end",
    );
    const firstPid = replyOf(viewer.received).match(/pid=(\d+)/)?.[1];
    await change("extensions.addServer", {
      server: { transport: "stdio", name: "files", command: "npx", args: [], env: {} },
    });
    await agent.request("second request");
    const second = await viewer.waitFor("agent.turn", (m) => m.payload.request === "second request");
    await viewer.waitFor(
      "agent.event",
      (m) => m.payload.turnId === second.payload.id && m.payload.event.type === "turn.end",
    );
    const reply = replyOf(viewer.received);
    expect(reply).toContain("previous=first request");
    expect(reply.match(/pid=(\d+)/)?.[1]).not.toBe(firstPid);
    expect(latest()?.loaded?.servers.map((s) => s.name)).toContain("files");
  });
});
