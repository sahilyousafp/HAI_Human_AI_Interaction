import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { Team } from "../../apps/bridge/src/agent/team.ts";
import type { Bridge } from "../../apps/bridge/src/server.ts";
import { fakeProvider } from "../../apps/bridge/test/fake-provider.ts";
import { sharedPythonEnv } from "../../apps/bridge/test/python-env.ts";
import { connectFakeRhino, rhinoBatch } from "../../apps/bridge/test/rhino-client.ts";
import { openSettings } from "../settings.ts";
import { openViewer, startTestBridge } from "../viewer.ts";

// How the Rhino pieces look: the approval card for a script, and Settings > Modelling.

const env = await sharedPythonEnv().catch(() => null);
let bridge: (Bridge & { port: number }) | null = null;
const closers: Array<() => void> = [];
test.afterEach(async () => {
  for (const close of closers.splice(0)) close();
  await bridge?.stop();
  bridge = null;
});

for (const scheme of ["light", "dark"] as const) {
  test(`the approval card for a script (${scheme})`, async ({ page }) => {
    test.skip(!env, "needs a Python 3.10 or newer on this machine");
    await page.emulateMedia({ colorScheme: scheme });
    bridge = await startTestBridge(page, {
      agent: fakeProvider(mkdtempSync(join(tmpdir(), "hai-visual-rhino-"))),
      ...(env ? { pythonEnv: env } : {}),
    });
    await openViewer(page);
    await page.evaluate(() => window.__HAI_INPUT__?.engaged(true));
    await expect(page.getByTestId("agent-status")).toHaveAttribute("data-state", "idle");
    await (bridge.agent as Team).request("delegate architect: python packages ladybug-core");
    const card = page.getByTestId("approval-card").last();
    await expect(card).toHaveAttribute("data-outcome", "pending");
    await expect(card.getByTestId("approval-installs")).toBeVisible();
    await expect(page.getByTestId("agent-panel")).toHaveScreenshot(`rhino-approval-card-${scheme}.png`);
  });

  test(`Settings > Modelling with Rhino connected (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    bridge = await startTestBridge(page);
    await openViewer(page);
    const rhino = await connectFakeRhino({ port: bridge.port } as AddressInfo, {
      token: bridge.token,
      document: "tower.3dm",
    });
    closers.push(() => rhino.ws.close());
    rhino.send(
      "rhino.objects",
      rhinoBatch({
        reset: true,
        sync: { done: 120, total: 4000 },
        notDrawn: { curves: 12, points: 0, annotations: 1, other: 0, heavy: 2 },
      }),
    );
    await openSettings(page, "modelling");
    await expect(page.getByTestId("modelling-not-drawn")).toBeVisible();
    await expect(page.getByTestId("settings-panel")).toHaveScreenshot(`rhino-modelling-${scheme}.png`);
  });
}
