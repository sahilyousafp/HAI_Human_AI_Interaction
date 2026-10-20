import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import { fakeProvider } from "../test/fake-provider.ts";
import { connectClient } from "../test/ws-client.ts";
import { createLogger, redact } from "./log.ts";
import { type Bridge, createBridge } from "./server.ts";

describe("redact", () => {
  it("replaces values under secret keys at any depth, and bearer tokens and given secrets in strings", () => {
    expect(
      redact(
        {
          server: { name: "tracker", headers: { Authorization: "Bearer abc" }, env: { KEY: "v" } },
          note: "sent Bearer xyz.123 to the server",
          url: "http://127.0.0.1:4870/mcp?t=session-token-1",
          list: [{ token: "t" }],
        },
        ["session-token-1"],
      ),
    ).toEqual({
      server: { name: "tracker", headers: "[redacted]", env: "[redacted]" },
      note: "sent Bearer [redacted] to the server",
      url: "http://127.0.0.1:4870/mcp?t=[redacted]",
      list: [{ token: "[redacted]" }],
    });
  });

  it("the logger writes one redacted line per event", () => {
    const lines: string[] = [];
    const log = createLogger(
      (l) => lines.push(l),
      () => ["tok-123"],
    );
    log.info("agent session started", { project: "D:/p", authorization: "Bearer tok-123" });
    log.error("failed", { message: "token tok-123 rejected" });
    expect(lines).toEqual([
      '[bridge] agent session started {"project":"D:/p","authorization":"[redacted]"}',
      '[bridge] error: failed {"message":"token [redacted] rejected"}',
    ]);
  });
});

describe("bridge logs", () => {
  const ORIGIN = "http://localhost:5173";
  const TOKEN = "log-test-session-token-0123456789";
  let bridge: Bridge | null = null;
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.close();
    await bridge?.stop();
    bridge = null;
  });

  it("logs contain no secrets: a full turn with an approval and a server with an authorization header", async () => {
    const lines: string[] = [];
    bridge = createBridge({
      host: "127.0.0.1",
      port: 0,
      allowedOrigins: [ORIGIN],
      version: "t",
      token: TOKEN,
      scene: { projectDir: join(mkdtempSync(join(tmpdir(), "aex-log-")), "project"), saveDelayMs: 50 },
      agent: { provider: fakeProvider(mkdtempSync(join(tmpdir(), "aex-fake-state-"))) },
      log: (line) => lines.push(line),
    });
    const address: AddressInfo = await bridge.start();
    await bridge.agent?.ready;
    const viewer = await connectClient(address, { token: TOKEN, origin: ORIGIN, track: sockets });

    const turn = bridge.agent?.request("shell: echo hi");
    const card = await viewer.waitFor("approval.pending");
    viewer.send("approval.decide", { id: card.payload.id, decision: "allow" });
    await turn;
    const secret = "Bearer sk-live-never-log-me-9999";
    viewer.send("extensions.addServer", {
      server: {
        transport: "http",
        name: "tracker",
        url: "https://mcp.example.com/mcp",
        headers: { Authorization: secret },
      },
    });
    await viewer.waitFor("extensions.snapshot", (m) => Boolean(m.payload.notice));

    const log = lines.join("\n");
    expect(log).toMatch(/agent session started/);
    expect(log).toMatch(/agent turn ended/);
    expect(log).toMatch(/tool approval .*"outcome":"allowed"/);
    expect(log).toMatch(/extension change applied/);
    expect(log).not.toContain("sk-live-never-log-me");
    expect(log).not.toContain(TOKEN); // the session token is in mcp.json and every MCP request, never in the log
  });
});
