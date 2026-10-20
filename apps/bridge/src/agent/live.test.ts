// Runs against the real, signed-in Claude Code CLI, so it is manual: CI skips it. Run it with
//   AEX_LIVE_CLAUDE=1 pnpm vitest run apps/bridge/src/agent/live.test.ts
// It uses one short request on the maintainer's own plan.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeCliProvider } from "@aex/agent-core";
import { afterEach, describe, expect, it } from "vitest";
import { type Bridge, createBridge } from "../server.ts";

const live = process.env.AEX_LIVE_CLAUDE === "1";

describe.skipIf(!live)("with the real Claude Code CLI (manual)", () => {
  let bridge: Bridge | null = null;
  afterEach(async () => {
    await bridge?.stop();
    bridge = null;
  });

  it("units honoured: a wall 3 m high is created with a height of 3000", { timeout: 240_000 }, async () => {
    bridge = createBridge({
      host: "127.0.0.1",
      port: 0,
      allowedOrigins: ["http://localhost:5173"],
      version: "live",
      scene: { projectDir: join(mkdtempSync(join(tmpdir(), "aex-live-")), "project"), saveDelayMs: 50 },
      agent: { provider: new ClaudeCliProvider() },
    });
    await bridge.start();
    await bridge.agent?.ready;
    expect(bridge.agent?.currentStatus.state).toBe("idle");
    const before = new Set(Object.keys(bridge.scene.scene.doc.elements));
    await bridge.agent?.request(
      'Add one wall named "Live check wall" on level L0, 3 m high and 200 mm thick, from (0, 30000) to (6000, 30000). Do not change anything else.',
    );
    const added = Object.values(bridge.scene.scene.doc.elements).filter((e) => !before.has(e.id));
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ type: "wall", height: 3000, thickness: 200 });
  });
});
