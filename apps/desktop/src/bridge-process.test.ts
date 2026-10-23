import { fork as nodeFork } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectClient } from "../../bridge/test/ws-client.ts";
import { bundleBridge } from "../scripts/bundle.ts";
import { APP_ORIGIN } from "./app-origin.ts";
import { type ChildLike, type Fork, startBridge } from "./bridge-process.ts";

/** Runs a module as a Node child with a message channel: the same surface as Electron's utility process. */
const forkNode: Fork = (entry, env) => {
  const child = nodeFork(entry, [], { env, stdio: ["ignore", "pipe", "pipe", "ipc"], cwd: tmpdir() });
  const like: ChildLike = {
    pid: child.pid,
    stdout: child.stdout,
    stderr: child.stderr,
    postMessage: (message) => {
      if (child.connected) child.send(message as never);
    },
    on: ((event: string, listener: (...args: never[]) => void) =>
      child.on(event, listener as never)) as ChildLike["on"],
    kill: () => child.kill(),
  };
  return like;
};

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

let root: string;
const script = (name: string, body: string): string => {
  const file = join(root, name);
  writeFileSync(file, body);
  return file;
};
const options = (entry: string, extra: object = {}) => ({
  fork: forkNode,
  entry,
  workspace: join(root, "ws"),
  origin: APP_ORIGIN,
  sampleScene: join(root, "sample.json"),
  ...extra,
});

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "hai-bridge-process-"));
});
afterAll(() => {
  // The temp folder is left to the system: Windows may still hold a file of a process that has just exited.
});

describe("startBridge with stand-in bridges", () => {
  it("reports the session the child sends", async () => {
    const entry = script(
      "ready.mjs",
      'process.send({ type: "ready", port: 4321, token: "abc" }); setInterval(() => {}, 1000);',
    );
    const bridge = startBridge(options(entry, { stopTimeoutMs: 300 }));
    expect(await bridge.session).toEqual({ port: 4321, token: "abc" });
    await bridge.stop();
  });

  it("passes the port, workspace, origin and sample the bridge reads", async () => {
    const entry = script(
      "env.mjs",
      `process.send({ type: "ready", port: 1, token: JSON.stringify([
         process.env.HAI_PORT, process.env.HAI_WORKSPACE, process.env.HAI_ALLOWED_ORIGINS, process.env.HAI_SAMPLE_SCENE]) });
       process.on("message", () => process.exit(0));`,
    );
    const bridge = startBridge(options(entry));
    const { token } = await bridge.session;
    expect(JSON.parse(token)).toEqual(["0", join(root, "ws"), APP_ORIGIN, join(root, "sample.json")]);
    await bridge.stop();
  });

  it("rejects with what the child printed when it stops before it is ready", async () => {
    const entry = script("crash.mjs", 'console.log("boom: no such folder"); process.exit(3);');
    const bridge = startBridge(options(entry));
    await expect(bridge.session).rejects.toThrow(/exit code 3[\s\S]*boom: no such folder/);
  });

  it("rejects and ends a child that never reports ready", async () => {
    const entry = script("silent.mjs", "setInterval(() => {}, 1000);");
    const bridge = startBridge(options(entry, { readyTimeoutMs: 300 }));
    await expect(bridge.session).rejects.toThrow(/did not report ready/);
  });

  it("asks the child to stop and waits for it", async () => {
    const entry = script(
      "polite.mjs",
      `process.send({ type: "ready", port: 1, token: "t" });
       process.on("message", (m) => { if (m.type === "stop") setTimeout(() => process.exit(0), 200); });`,
    );
    const bridge = startBridge(options(entry));
    await bridge.session;
    const started = Date.now();
    await bridge.stop();
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);
  });

  it("ends a child that ignores the request to stop", async () => {
    const entry = script(
      "stubborn.mjs",
      'process.send({ type: "ready", port: 1, token: "t" }); setInterval(() => {}, 1000);',
    );
    const bridge = startBridge(options(entry, { stopTimeoutMs: 300 }));
    await bridge.session;
    await bridge.stop();
    // stop() returns only when the process has exited.
    await bridge.stop();
  });
});

describe("the real bridge bundle", () => {
  let bridgeDir: string;
  let stateDir: string;
  let workspace: string;

  beforeAll(async () => {
    bridgeDir = join(root, "bundle");
    // The bridge's real start-up and stop code, with the fake Claude Code CLI as its agent.
    await bundleBridge(bridgeDir, join(import.meta.dirname, "..", "test", "bridge-with-fake-claude.ts"));
    // The fake provider looks for the CLI beside its own file, which in a bundle is the bundle's folder.
    copyFileSync(
      join(import.meta.dirname, "..", "..", "bridge", "test", "fake-claude.mjs"),
      join(bridgeDir, "fake-claude.mjs"),
    );
    stateDir = join(root, "fake-state");
    mkdirSync(stateDir, { recursive: true });
    workspace = join(root, "real-ws");
  }, 30_000);

  it("quitting ends the bridge and the agent process it started", async () => {
    const bridge = startBridge({
      ...options(join(bridgeDir, "main.js"), {
        workspace,
        sampleScene: join(bridgeDir, "samples", "mixed-use-block.hai.json"),
        env: { FAKE_CLAUDE_STATE: stateDir },
      }),
    });
    const { port, token } = await bridge.session;

    const viewer = await connectClient({ port } as AddressInfo, { token, origin: APP_ORIGIN });
    viewer.send("agent.send", { text: "slow", agent: "mochi" });
    // The agent process is running when the fake CLI has recorded its start.
    const starts = async () =>
      readdirSync(stateDir)
        .filter((f) => f.startsWith("start-"))
        .map((f) => JSON.parse(readFileSync(join(stateDir, f), "utf8")).pid as number);
    const deadline = Date.now() + 20_000;
    while ((await starts()).length === 0 && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 100));
    const pids = await starts();
    expect(pids.length).toBeGreaterThan(0);
    for (const pid of pids) expect(alive(pid)).toBe(true);

    await bridge.stop();
    viewer.ws.terminate();

    // No agent is left behind, and the session file is gone.
    const waitGone = Date.now() + 5_000;
    while (pids.some(alive) && Date.now() < waitGone) await new Promise((r) => setTimeout(r, 100));
    for (const pid of pids) expect(alive(pid)).toBe(false);
    expect(existsSync(join(workspace, ".hai", "session.json"))).toBe(false);
  }, 60_000);
});
